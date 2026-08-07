// Load and validate environment first - will throw if missing required vars
import { env } from './config/env';

import express from 'express';
import http from 'http';
import cors from 'cors';
import { WebSocketServer } from 'ws';
import { connectDB } from './db/mongo';
import { companiesRouter } from './routes/companies';
import { meetingsRouter } from './routes/meetings';
import { slackRouter } from './routes/slack';
import { webhooksRouter } from './routes/webhooks';
import { githubRouter } from './routes/github';
import { licensesRouter } from './routes/licenses';
import { authRouter } from './routes/auth';
import { API_ROUTES } from '@taro/shared';
import { slackListener } from './services/slackListener';
import { realtimeSessions, type Direction } from './services/realtime';
import { asrAvailable } from './services/asr';
import { errorHandler } from './middleware/errorHandler';
import { CompanyModel, LicenseModel, GithubConnectionModel } from './db/models';
import { generateLicenseKey } from './lib/licenseKey';

const app = express();

// Middleware
app.use(cors());
// MeetingBaas `complete` webhooks carry the full word-level transcript;
// the 100kb default rejects meetings longer than ~10 minutes with a 413
app.use(express.json({ limit: '10mb' }));

// Health check
app.get(API_ROUTES.HEALTH, (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Routes
app.use(API_ROUTES.COMPANIES, companiesRouter);
app.use(API_ROUTES.MEETINGS, meetingsRouter);
app.use('/api/slack', slackRouter);
app.use('/api/github', githubRouter);
app.use('/api/licenses', licensesRouter);
app.use('/api/auth', authRouter);
app.use('/api/webhooks', webhooksRouter);

// Error handler (must be after routes)
app.use(errorHandler);

// HTTP server wraps express so the realtime WebSockets share port 4000
// (and therefore the single ngrok tunnel)
const server = http.createServer(app);
const wss = new WebSocketServer({ noServer: true });

// MeetingBaas dials these endpoints when a bot joins with streaming enabled:
//   /ws/audio-in/<meetingId>  - meeting audio to us
//   /ws/audio-out/<meetingId> - audio we push into the meeting (ding)
server.on('upgrade', (request, socket, head) => {
  const url = new URL(request.url ?? '/', `http://${request.headers.host}`);
  // /ws/audio/<id> is the shared bidirectional endpoint (what MeetingBaas's
  // own bots use); the -in/-out forms are kept for older bot records
  const match = url.pathname.match(/^\/ws\/audio(?:-(in|out))?\/([a-f0-9]{24})$/);

  if (!match) {
    socket.destroy();
    return;
  }

  const direction = (match[1] ?? 'shared') as Direction;
  const meetingId = match[2];
  wss.handleUpgrade(request, socket, head, (ws) => {
    console.log(`[Realtime] WebSocket connected: ${direction} for meeting ${meetingId}`);
    realtimeSessions
      .handleConnection(meetingId, direction, ws)
      .catch((error) => {
        console.error('[Realtime] Connection error:', error);
        ws.close();
      });
  });
});

// Start server
async function start() {
  try {
    await connectDB();
    console.log('Connected to MongoDB');

    // GitHub connections from the personal-token era are retired; the
    // connector is now a GitHub App installation
    const legacyGithub = await GithubConnectionModel.deleteMany({ installationId: { $exists: false } });
    if (legacyGithub.deletedCount) {
      console.log(`[Migrate] Removed ${legacyGithub.deletedCount} legacy GitHub token connection(s)`);
    }

    // Companies created before licenses existed get a key and a claimed
    // license row at boot, so redeem/lookup work uniformly
    const companies = await CompanyModel.find();
    for (const company of companies) {
      if (!company.licenseKey) {
        company.licenseKey = generateLicenseKey();
        await company.save();
        console.log(`[Migrate] License key for "${company.name}": ${company.licenseKey}`);
      }
      await LicenseModel.updateOne(
        { key: company.licenseKey },
        {
          $set: { companyId: company._id.toString() },
          $setOnInsert: { claimedAt: company.createdAt },
        },
        { upsert: true }
      );
    }

    server.listen(env.port, () => {
      console.log(`Taro API server running on port ${env.port}`);
      console.log(
        asrAvailable()
          ? 'Realtime ASR: ready (sherpa-onnx loaded)'
          : 'Realtime ASR: UNAVAILABLE - post-meeting fallback only'
      );
    });

    // Start Slack listener for auto-join (optional - only if token configured)
    if (env.slackAppToken) {
      await slackListener.start();
    } else {
      console.log('Slack listener: Skipped (no SLACK_APP_TOKEN)');
    }
  } catch (error) {
    console.error('Failed to start server:', error);
    process.exit(1);
  }
}

// Keep the webhook server alive if a stray promise rejects (Node's default
// is to crash the process)
process.on('unhandledRejection', (reason) => {
  console.error('Unhandled promise rejection:', reason);
});

// Graceful shutdown
process.on('SIGTERM', () => {
  console.log('SIGTERM received, shutting down...');
  process.exit(0);
});

start();
