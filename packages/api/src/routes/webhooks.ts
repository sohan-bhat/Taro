/**
 * MeetingBaas webhooks (v1 API). Realtime commands are handled separately in
 * services/realtime.ts as audio streams in; this is the post-meeting path,
 * covering status tracking, transcript persistence, and a fallback command
 * sweep for anything the live pipeline missed.
 */

import { Router, type Router as RouterType } from 'express';
import { MeetingModel, ActionLogModel } from '../db/models';
import { SlackService } from '../services';
import { executeCommand } from '../services/executor';
import { flattenTranscript, extractCommands, type TranscriptSegment } from '../services/transcript';
import { MEETING_STATUS } from '@taro/shared';

export const webhooksRouter: RouterType = Router();

// Bot status codes -> our meeting statuses
const JOINING_CODES = ['joining_call', 'in_waiting_room'];
const ACTIVE_CODES = [
  'in_call_not_recording',
  'in_call_recording',
  'recording_paused',
  'recording_resumed',
];
const ERROR_CODES = [
  'bot_rejected',
  'bot_removed',
  'waiting_room_timeout',
  'invalid_meeting_url',
  'meeting_error',
];

// Acknowledge immediately, then process async: command execution can take seconds
// (Gemini + Slack calls), and a slow response would trigger webhook retries and duplicate Slack posts.
webhooksRouter.post('/meetingbaas', (req, res) => {
  res.sendStatus(200);
  processEvent(req.body).catch((error) => {
    console.error('[Webhook] Unhandled processing error:', error);
  });
});

async function processEvent(payload: { event?: string; data?: Record<string, unknown> }): Promise<void> {
  const { event, data } = payload ?? {};
  console.log(`[Webhook] MeetingBaas event: ${event}`);

  const botId = data?.bot_id;
  if (!botId || typeof botId !== 'string') {
    console.log('[Webhook] No bot_id in payload:', JSON.stringify(payload).slice(0, 500));
    return;
  }

  const meeting = await MeetingModel.findOne({ botId });
  if (!meeting) {
    console.log(`[Webhook] No meeting found for bot: ${botId}`);
    return;
  }

  switch (event) {
    case 'bot.status_change': {
      const status = (data as { status?: { code?: string } }).status?.code;
      console.log(`[Webhook] Bot status: ${status}`);

      if (status && JOINING_CODES.includes(status)) {
        await MeetingModel.findByIdAndUpdate(meeting._id, { status: MEETING_STATUS.JOINING });
      } else if (status && ACTIVE_CODES.includes(status)) {
        await MeetingModel.findByIdAndUpdate(meeting._id, {
          status: MEETING_STATUS.ACTIVE,
          startedAt: meeting.startedAt ?? new Date(),
        });
      } else if (status === 'call_ended') {
        await MeetingModel.findByIdAndUpdate(meeting._id, {
          status: MEETING_STATUS.ENDED,
          endedAt: new Date(),
        });
      } else if (status && ERROR_CODES.includes(status)) {
        await MeetingModel.findByIdAndUpdate(meeting._id, { status: MEETING_STATUS.ERROR });
      } else {
        console.log(`[Webhook] Unmapped bot status: ${status}`);
      }
      break;
    }

    // v1 uses `complete`/`transcription_complete`; v2 uses `bot.completed`.
    case 'complete':
    case 'transcription_complete':
    case 'bot.completed': {
      const segments = (data.transcript ?? []) as TranscriptSegment[];
      let fullText = flattenTranscript(segments);
      // We opt out of MeetingBaas transcription to get the raw audio stream instead, so `complete`
      // usually carries no transcript; fall back to what our own live ASR accumulated during the call.
      if (fullText.length === 0 && meeting.liveTranscript) {
        fullText = meeting.liveTranscript;
        console.log(`[Webhook] Using live ASR transcript for fallback (${fullText.length} chars)`);
      }
      console.log(`[Webhook] ${event}: transcript ${fullText.length} chars, ${segments.length} segments`);

      const liveAlready = await ActionLogModel.countDocuments({ meetingId: meeting._id.toString(), mode: 'live' });
      // Nothing to act on and nothing ran live yet: record the end state and wait for a later event with words.
      if (fullText.length === 0 && liveAlready === 0) {
        console.log(`[Webhook] ${event} carried no transcript yet - waiting`);
        await MeetingModel.updateOne(
          { _id: meeting._id, status: { $ne: MEETING_STATUS.ENDED } },
          { status: MEETING_STATUS.ENDED, endedAt: meeting.endedAt ?? new Date() }
        );
        return;
      }

      // Atomically claim post-meeting processing so webhook retries and the complete/transcription_complete
      // pair don't double-execute it.
      const claimed = await MeetingModel.findOneAndUpdate(
        { _id: meeting._id, commandsProcessedAt: { $exists: false } },
        {
          $set: {
            commandsProcessedAt: new Date(),
            transcript: fullText,
            status: MEETING_STATUS.ENDED,
            endedAt: meeting.endedAt ?? new Date(),
          },
        },
        { new: true }
      );

      if (!claimed) {
        console.log('[Webhook] Post-meeting processing already claimed, skipping');
        return;
      }

      const meetingId = claimed._id.toString();

      // If the realtime pipeline already executed commands, don't re-run extraction on the final
      // transcript: the live ASR text and the provider transcript never match verbatim, so
      // re-running would double-post every action.
      const liveActions = await ActionLogModel.find({ meetingId, mode: 'live' }).sort({ createdAt: 1 });

      let summaries: string[];
      if (liveActions.length > 0) {
        console.log(`[Webhook] ${liveActions.length} live command(s) already executed - skipping fallback sweep`);
        summaries = liveActions.map((a) =>
          a.status === 'success' ? `✅ ${a.result}` : `❌ "${a.command.slice(0, 60)}" (${a.status})`
        );
      } else {
        const commands = extractCommands(fullText);
        console.log(`[Webhook] Fallback sweep found ${commands.length} command(s):`, commands);
        summaries = [];
        for (const command of commands) {
          const result = await executeCommand(meetingId, claimed.companyId, command, 'post_meeting', fullText);
          summaries.push(result.summary);
        }
      }

      await postSummaryToSlack(claimed.companyId, claimed.slackChannelId, claimed.slackThreadTs, summaries);
      break;
    }

    // v1 `failed`; v2 `bot.failed`
    case 'failed':
    case 'bot.failed': {
      console.error('[Webhook] Bot failed:', JSON.stringify(data).slice(0, 500));
      await MeetingModel.findByIdAndUpdate(meeting._id, {
        status: MEETING_STATUS.ERROR,
        endedAt: new Date(),
      });
      await postSummaryToSlack(meeting.companyId, meeting.slackChannelId, meeting.slackThreadTs, [
        '⚠️ Taro could not record this meeting.',
      ]);
      break;
    }

    default:
      console.log(`[Webhook] Unhandled event: ${event}`);
  }
}

/**
 * Report results back to the Slack thread where the meeting link was posted.
 */
async function postSummaryToSlack(
  companyId: string,
  channelId: string | undefined,
  threadTs: string | undefined,
  summaries: string[]
): Promise<void> {
  if (!channelId) return;

  try {
    const slack = await SlackService.fromCompanyId(companyId);
    if (!slack) return;

    const text =
      summaries.length > 0
        ? `Meeting ended. Here's what I did:\n${summaries.join('\n')}`
        : `Meeting ended. No "Hey Taro" commands were detected.`;

    await slack.postToChannelId(channelId, text, threadTs);
  } catch (error) {
    console.error('[Webhook] Failed to post summary to Slack:', error);
  }
}
