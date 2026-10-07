// Must be the first import so a missing env var fails fast, before anything else loads.
import { env, googleCalendarConfigured } from './config/env';

import express from 'express';
import http from 'http';
import path from 'path';
import cors from 'cors';
import { WebSocketServer } from 'ws';
import { API_ROUTES } from '@taro/shared';
import { connectDB, mongoose } from './db/mongo';
import { runMigrations } from './db/migrations';
import { authRouter } from './routes/auth';
import { workspaceRouter } from './routes/workspace';
import { providersRouter } from './routes/providers';
import { meetingsRouter } from './routes/meetings';
import { slackRouter } from './routes/slack';
import { githubRouter } from './routes/github';
import { webhooksRouter } from './routes/webhooks';
import { metaRouter } from './routes/meta';
import { extensionRouter, sessionsRouter } from './routes/extension';
import { inboundRouter } from './routes/inbound';
import { calendarRouter } from './routes/calendar';
import { googleCalendarRouter } from './routes/googleCalendar';
import { outgoingWebhooksRouter } from './routes/outgoingWebhooks';
import { calendarTick } from './services/calendar/scheduler';
import { googleCalendarTick } from './services/calendar/googleSync';
import { webhookTick } from './services/webhooks/dispatcher';
import { calendarInvitesConfigured } from './lib/inviteAddress';
import { slackListener } from './services/slackListener';
import { realtimeSessions, type Direction } from './services/realtime';
import { errorHandler } from './middleware/errorHandler';
import { isAllowedCorsOrigin } from './lib/origins';
import { log, errorMessage } from './lib/logger';

const app = express();
app.disable('x-powered-by');
// Behind a platform proxy (Render, Fly, Railway); needed for real client IPs in rate limits.
app.set('trust proxy', env.trustProxyHops);

app.use((_req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('X-Frame-Options', 'DENY');
  next();
});

// Bearer tokens, not cookies, so CORS is defense in depth: only the dashboard's
// own origins may call the API from a browser. Non-browser callers send no Origin.
app.use(
  cors({
    origin: (origin, callback) => callback(null, !origin || isAllowedCorsOrigin(origin)),
    maxAge: 600,
  })
);
// Invitation mail is read by its own route, with its own size cap, before the JSON parser sees it.
app.use('/api/inbound', inboundRouter);
app.use(express.json({ limit: '1mb' }));

app.get(API_ROUTES.HEALTH, (_req, res) => {
  res.json({ status: 'ok' });
});

// Readiness for load balancers: only take traffic once the database is reachable.
app.get(API_ROUTES.READY, (_req, res) => {
  const ready = mongoose.connection.readyState === 1;
  res.status(ready ? 200 : 503).json({ status: ready ? 'ready' : 'starting', meetings: realtimeSessions.activeCount });
});

// MeetingBaas fetches the bot's avatar server-side.
app.get('/taro-bot.jpg', (_req, res) => {
  res.type('image/jpeg');
  res.setHeader('Cache-Control', 'public, max-age=86400');
  res.sendFile(path.resolve(__dirname, '../assets/taro-bot.jpg'));
});

app.use('/api/meta', metaRouter);
app.use('/api/auth', authRouter);
app.use('/api/workspace', workspaceRouter);
app.use('/api/providers', providersRouter);
app.use('/api/meetings', meetingsRouter);
app.use('/api/slack', slackRouter);
app.use('/api/github', githubRouter);
app.use('/api/webhooks', webhooksRouter);
app.use('/api/extension', extensionRouter);
app.use('/api/sessions', sessionsRouter);
app.use('/api/calendar', calendarRouter);
app.use('/api/google-calendar', googleCalendarRouter);
app.use('/api/integrations/webhooks', outgoingWebhooksRouter);

app.use((_req, res) => {
  res.status(404).json({ error: 'Not found', code: 'NOT_FOUND' });
});
// Must run after the routes so it can catch their errors.
app.use(errorHandler);

// The realtime WebSockets share the HTTP port, so one public URL serves everything.
const server = http.createServer(app);
const wss = new WebSocketServer({ noServer: true, maxPayload: 1024 * 1024 });

// MeetingBaas dials /ws/audio-in/<meeting>/<secret> (audio to us) and
// /ws/audio-out/<meeting>/<secret> (the ding back). The secret was minted when
// the bot was sent, so nobody else can feed or listen to a meeting's stream.
server.on('upgrade', (request, socket, head) => {
  // Node removes its own error listener when it hands the socket over; without
  // one, a client reset during the async check below would crash the process.
  const onSocketError = (error: Error) => log.debug(`[Realtime] Socket error before upgrade: ${error.message}`);
  socket.on('error', onSocketError);

  // Matched on the raw path: URL parsing throws on hostile request targets like "//".
  const path = (request.url ?? '').split('?')[0];
  const match = path.match(/^\/ws\/audio(?:-(in|out))?\/([a-f0-9]{24})\/([A-Za-z0-9_-]{32,128})$/);
  if (!match) {
    socket.destroy();
    return;
  }
  const direction = (match[1] ?? 'shared') as Direction;
  const meetingId = match[2];
  const token = match[3];

  realtimeSessions
    .authorize(meetingId, token)
    .then((ok) => {
      if (socket.destroyed) return;
      if (!ok) {
        socket.end('HTTP/1.1 401 Unauthorized\r\nConnection: close\r\n\r\n');
        return;
      }
      socket.removeListener('error', onSocketError);
      wss.handleUpgrade(request, socket, head, (ws) => {
        // Listen right away: a frame over maxPayload can arrive before the session is set up.
        ws.on('error', (error) => log.warn(`[Realtime] Socket error for meeting ${meetingId}: ${error.message}`));
        log.debug(`[Realtime] ${direction} socket connected for meeting ${meetingId}`);
        realtimeSessions.handleConnection(meetingId, direction, ws).catch((error) => {
          log.error('[Realtime] Connection error:', errorMessage(error));
          ws.close();
        });
      });
    })
    .catch((error) => {
      log.error('[Realtime] Authorization error:', errorMessage(error));
      socket.destroy();
    });
});

setInterval(() => {
  if (mongoose.connection.readyState !== 1) return;
  realtimeSessions.sweepStale().catch((error) => log.warn('[Realtime] Stale meeting sweep failed:', errorMessage(error)));
}, 2 * 60 * 1000).unref();

// Calendar meetings: confirms and sends bots for meetings about to start, and keeps MeetingBaas in step.
// Connected Google Calendars are read on the same clock, in a pass of their own so a slow read never
// holds up a meeting that's starting.
setInterval(() => {
  if (mongoose.connection.readyState !== 1) return;
  const google = googleCalendarConfigured();
  if (!calendarInvitesConfigured() && !google) return;
  calendarTick().catch((error) => log.warn('[Calendar] Tick failed:', errorMessage(error)));
  if (google) googleCalendarTick().catch((error) => log.warn('[Calendar] Google Calendar pass failed:', errorMessage(error)));
}, 30 * 1000).unref();

// Outgoing webhooks: retries that are due. New events are sent the moment they're queued.
setInterval(() => {
  if (mongoose.connection.readyState !== 1) return;
  webhookTick().catch((error) => log.warn('[Webhooks] Tick failed:', errorMessage(error)));
}, 5 * 1000).unref();

async function start() {
  try {
    await connectDB();
    log.info('[Boot] Connected to MongoDB');
    await runMigrations();

    server.listen(env.port, () => {
      log.info(`[Boot] Taro API listening on port ${env.port}`);
    });

    if (env.slackAppToken) {
      await slackListener.start();
    } else {
      log.warn('[Boot] SLACK_APP_TOKEN is not set, so Taro will not see meeting links posted in Slack.');
    }
  } catch (error) {
    log.error('[Boot] Failed to start:', error);
    process.exit(1);
  }
}

// Log instead of crashing on a stray rejection, and keep serving other meetings.
process.on('unhandledRejection', (reason) => {
  log.error('[Process] Unhandled promise rejection:', reason);
});

let shuttingDown = false;
function shutdown(reason: string, exitCode = 0) {
  if (shuttingDown) return;
  shuttingDown = true;
  log.info(`[Boot] ${reason}, shutting down`);
  // Hard stop if anything hangs; platforms send SIGKILL soon after anyway.
  setTimeout(() => process.exit(exitCode), 10_000).unref();
  slackListener.stop();
  // Frees memory only: meeting status is left alone so a reconnect can resume it.
  realtimeSessions.closeAll();
  for (const client of wss.clients) client.terminate();
  server.close(() => {
    mongoose
      .disconnect()
      .catch(() => {})
      .finally(() => process.exit(exitCode));
  });
}
process.on('SIGTERM', () => shutdown('SIGTERM received'));
process.on('SIGINT', () => shutdown('SIGINT received'));
// State after an uncaught exception can't be trusted; log it and restart cleanly.
process.on('uncaughtException', (error) => {
  log.error('[Process] Uncaught exception:', error);
  shutdown('Uncaught exception', 1);
});

start();
