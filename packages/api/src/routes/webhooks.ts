/**
 * MeetingBaas per-bot callbacks (bot.completed, bot.failed). Each bot was
 * created with its meeting's secret as the callback secret, which MeetingBaas
 * returns in the x-mb-secret header; only events carrying the right secret are
 * acted on. Live commands run in services/realtime.ts as audio streams in;
 * this is the end-of-call path: final status, plus a sweep for any command
 * the live pipeline missed.
 *
 * MeetingBaas also delivers account-level events (bot.status_change) to this
 * URL. Those are signed by Svix with a secret that lives in each customer's
 * MeetingBaas dashboard, so Taro can't check them. They're acknowledged and
 * dropped: answering with errors would make MeetingBaas disable the endpoint
 * after a few days and email the customer.
 */

import { Router, type Router as RouterType } from 'express';
import { isValidObjectId } from 'mongoose';
import { COPY, MEETING_STATUS, cleanDashes } from '@taro/shared';
import { ActionLogModel, MeetingModel } from '../db/models';
import { asyncHandler } from '../middleware/errorHandler';
import { safeEqual, sha256 } from '../lib/crypto';
import { log, errorMessage } from '../lib/logger';
import { SlackService } from '../services';
import { executeCommand } from '../services/executor';
import { recapLine, recapLines } from '../services/outcomes';
import { extractCommands } from '../services/transcript';
import { loadProviders } from '../services/workspaceProviders';
import { emitMeetingEnded } from '../services/webhooks/dispatcher';

export const webhooksRouter: RouterType = Router();

interface CallbackPayload {
  event?: string;
  data?: {
    bot_id?: string;
    error_code?: string;
    error_message?: string;
    extra?: { taroMeetingId?: string } | null;
  };
  // MeetingBaas v2 sends the bot's extra beside data; older payloads nested it inside.
  extra?: { taroMeetingId?: string } | null;
}

// Payload fields are untrusted: only short plain strings get through.
function text(value: unknown, max: number): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim().slice(0, max) : undefined;
}

webhooksRouter.post(
  '/meetingbaas',
  asyncHandler(async (req, res) => {
    const payload = (req.body ?? {}) as CallbackPayload;
    const secret = req.header('x-mb-secret') || '';
    // Only plain strings reach the query; an object here would be a query operator.
    const rawMeetingId = payload.extra?.taroMeetingId ?? payload.data?.extra?.taroMeetingId;
    const rawBotId = payload.data?.bot_id;
    const meetingId = typeof rawMeetingId === 'string' && isValidObjectId(rawMeetingId) ? rawMeetingId : null;
    const botId = typeof rawBotId === 'string' && rawBotId ? rawBotId : null;

    const query = meetingId ? { _id: meetingId } : botId ? { botId } : null;
    const meeting = query ? await MeetingModel.findOne(query).select('+secretHash') : null;
    if (!meeting?.secretHash || !secret || !safeEqual(sha256(secret), meeting.secretHash)) {
      const event = typeof payload.event === 'string' ? payload.event.slice(0, 40) : 'unknown';
      // Completion callbacks always carry the secret, so one without it is worth a look
      const expectedSecret = event === 'bot.completed' || event === 'bot.failed';
      log[expectedSecret ? 'warn' : 'debug'](`[Webhook] Ignored unauthenticated ${event} event`);
      return res.status(200).json({ ignored: true });
    }

    // Acknowledge first: command execution can take seconds and a slow
    // response would make MeetingBaas retry and double-post results.
    res.sendStatus(200);
    processEvent(meeting._id.toString(), payload).catch((error) =>
      log.error('[Webhook] Processing failed:', errorMessage(error))
    );
  })
);

async function processEvent(meetingId: string, payload: CallbackPayload): Promise<void> {
  const meeting = await MeetingModel.findById(meetingId);
  if (!meeting) return;
  log.info(`[Webhook] ${payload.event} for meeting ${meetingId}`);

  switch (payload.event) {
    case 'bot.completed': {
      // We opt out of MeetingBaas transcription to get raw audio, so the
      // transcript is whatever our own live transcription heard.
      const fullText = meeting.liveTranscript || '';

      // Claim post-meeting processing atomically so retries can't run it twice.
      const claimed = await MeetingModel.findOneAndUpdate(
        { _id: meeting._id, commandsProcessedAt: { $exists: false } },
        {
          $set: {
            commandsProcessedAt: new Date(),
            transcript: fullText || undefined,
            status: MEETING_STATUS.ENDED,
            endedAt: meeting.endedAt ?? new Date(),
          },
        },
        { new: true }
      );
      if (!claimed) return;

      // Commands already run live are not re-extracted: live and final text never
      // match verbatim, so a second pass would double-post every action.
      const liveActions = await ActionLogModel.find({ meetingId, mode: 'live' }).sort({ createdAt: 1 }).lean();
      let lines: string[];
      if (liveActions.length > 0) {
        lines = recapLines(liveActions);
      } else {
        const commands = extractCommands(fullText);
        const llm = commands.length > 0 ? (await loadProviders(claimed.companyId))?.llm ?? null : null;
        lines = [];
        for (const command of commands) {
          const result = await executeCommand(meetingId, claimed.companyId, command, 'post_meeting', fullText, llm);
          lines.push(recapLine(result.outcome, command, result.summary));
        }
      }
      await postToThread(claimed.companyId, claimed.slackChannelId, claimed.slackThreadTs, COPY.recap(lines));
      emitMeetingEnded(meetingId, claimed.companyId, lines);
      return;
    }

    case 'bot.failed': {
      const code = text(payload.data?.error_code, 80);
      const message = text(payload.data?.error_message, 500);
      // The dashboard explains the code and falls back to MeetingBaas's message. An earlier
      // note on the meeting (no transcription, say) must not pose as the reason.
      await MeetingModel.updateOne(
        { _id: meeting._id },
        {
          $set: {
            status: MEETING_STATUS.ERROR,
            endedAt: new Date(),
            ...(message ? { errorMessage: message } : {}),
            ...(code ? { errorCode: code } : {}),
          },
          ...(message ? {} : { $unset: { errorMessage: 1 } }),
        }
      );
      const why = message ? cleanDashes(message) : '';
      // A bot that never got in couldn't join; one that was in couldn't stay.
      await postToThread(
        meeting.companyId,
        meeting.slackChannelId,
        meeting.slackThreadTs,
        meeting.startedAt ? COPY.couldntStay(why) : COPY.slackCouldntJoin(why)
      );
      // A bot that was in the call ended it; one that never got in never started it
      if (meeting.startedAt) emitMeetingEnded(meetingId, meeting.companyId);
      return;
    }

    default:
      log.debug(`[Webhook] Ignoring event ${payload.event}`);
  }
}

async function postToThread(
  companyId: string,
  channelId: string | undefined,
  threadTs: string | undefined,
  message: string
): Promise<void> {
  if (!channelId) return;
  try {
    const slack = await SlackService.fromCompanyId(companyId);
    if (!slack) return;
    await slack.postToChannelId(channelId, message, threadTs);
  } catch (error) {
    log.warn('[Webhook] Failed to post to the Slack thread:', errorMessage(error));
  }
}
