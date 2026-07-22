/**
 * Webhook endpoints for receiving data from external services.
 * Currently handles MeetingBaas transcription webhooks.
 *
 * Note on flow: MeetingBaas delivers `bot.status_change`, `failed`, and
 * `complete` over webhooks. Per-utterance live transcripts require their
 * WebSocket streaming setup, so commands are detected and executed from the
 * full transcript when the meeting completes. The `transcript` case below is
 * kept so live chunks are handled if streaming is ever wired up.
 */

import { Router, type Router as RouterType } from 'express';
import { MeetingModel, ActionLogModel } from '../db/models';
import { SlackService, parseIntent } from '../services';
import { WAKE_WORD_VARIATIONS, MAX_COMMAND_WORDS, INTENTS, MEETING_STATUS } from '@taro/shared';
import { asyncHandler } from '../middleware/errorHandler';

export const webhooksRouter: RouterType = Router();

// Buffer to accumulate transcript text per meeting (for wake word detection across chunks)
const transcriptBuffer: Map<string, string> = new Map();

/**
 * Lowercase, strip punctuation, and collapse whitespace so wake-word matching
 * is resilient to transcription formatting ("Hey, Taro." → "hey taro").
 */
export function normalizeTranscript(text: string): string {
  return text
    .toLowerCase()
    .replace(/[.,!?;:"""''`]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Find every wake-word occurrence in a transcript and return the command
 * text following each one. A command runs until the next wake word (or end
 * of text) and is capped at MAX_COMMAND_WORDS so trailing meeting chatter
 * doesn't swamp the intent parser.
 */
export function extractCommands(text: string): string[] {
  const normalized = normalizeTranscript(text);
  if (!normalized) return [];

  const pattern = new RegExp(`\\b(?:${WAKE_WORD_VARIATIONS.join('|')})\\b`, 'g');
  const matches = [...normalized.matchAll(pattern)];
  if (matches.length === 0) return [];

  const commands: string[] = [];
  for (let i = 0; i < matches.length; i++) {
    const start = (matches[i].index ?? 0) + matches[i][0].length;
    const end = i + 1 < matches.length ? matches[i + 1].index : normalized.length;
    let command = normalized.slice(start, end).trim();

    const words = command.split(' ');
    if (words.length > MAX_COMMAND_WORDS) {
      command = words.slice(0, MAX_COMMAND_WORDS).join(' ');
    }

    if (command.length > 3) {
      commands.push(command);
    }
  }
  return commands;
}

/**
 * Reassemble the full transcript text from MeetingBaas `complete` payload
 * segments. Words are joined with spaces and re-normalized, which is safe
 * whether or not the provider embeds spaces in each word token.
 */
function assembleTranscript(segments: Array<{ words?: Array<{ word: string }> }>): string {
  return segments
    .map((segment) => segment.words?.map((w) => w.word).join(' ') || '')
    .join(' ');
}

/**
 * MeetingBaas webhook endpoint
 * Receives events: bot.status_change, transcript, complete, failed
 */
webhooksRouter.post(
  '/meetingbaas',
  asyncHandler(async (req, res) => {
    // Log full payload for debugging
    console.log(`[Webhook] Full payload:`, JSON.stringify(req.body, null, 2));

    const { event, data } = req.body;

    console.log(`[Webhook] MeetingBaas event: ${event}`);

    // Find meeting by botId
    const botId = data?.bot_id;
    if (!botId) {
      console.log('[Webhook] No bot_id in payload');
      return res.sendStatus(200);
    }

    const meeting = await MeetingModel.findOne({ botId });
    if (!meeting) {
      console.log(`[Webhook] No meeting found for bot: ${botId}`);
      return res.sendStatus(200);
    }

    switch (event) {
      case 'bot.status_change': {
        const status = data.status?.code;
        console.log(`[Webhook] Bot status: ${status}`);

        // Map MeetingBaas statuses to our statuses
        if (status === 'joining_call' || status === 'in_waiting_room') {
          await MeetingModel.findByIdAndUpdate(meeting._id, { status: MEETING_STATUS.JOINING });
        } else if (status === 'in_call_not_recording' || status === 'in_call_recording') {
          await MeetingModel.findByIdAndUpdate(meeting._id, {
            status: MEETING_STATUS.ACTIVE,
            startedAt: new Date(),
          });
        } else if (status === 'call_ended' || status === 'fatal') {
          await MeetingModel.findByIdAndUpdate(meeting._id, {
            status: MEETING_STATUS.ENDED,
            endedAt: new Date(),
          });
          // Clear transcript buffer
          transcriptBuffer.delete(meeting._id.toString());
        }
        break;
      }

      case 'failed': {
        console.error(`[Webhook] Bot failed to join:`, data?.error || data);
        await MeetingModel.findByIdAndUpdate(meeting._id, {
          status: MEETING_STATUS.ERROR,
          endedAt: new Date(),
        });
        transcriptBuffer.delete(meeting._id.toString());
        break;
      }

      case 'transcript': {
        // Live transcription chunks (only delivered when streaming is configured)
        const transcript = data.transcript || data.text || '';
        const speaker = data.speaker || 'Unknown';

        console.log(`[Webhook] Transcript from ${speaker}: "${transcript}"`);

        // Accumulate transcript in buffer (last ~500 chars)
        const meetingId = meeting._id.toString();
        const currentBuffer = transcriptBuffer.get(meetingId) || '';
        const newBuffer = normalizeTranscript(currentBuffer + ' ' + transcript).slice(-500);
        transcriptBuffer.set(meetingId, newBuffer);

        const commands = extractCommands(newBuffer);
        if (commands.length > 0) {
          // Execute the most recent command and clear the buffer to prevent re-triggering
          const command = commands[commands.length - 1];
          console.log(`[Webhook] Wake word detected! Command: "${command}"`);
          transcriptBuffer.set(meetingId, '');
          await executeCommand(meeting._id.toString(), meeting.companyId, command);
        }
        break;
      }

      case 'complete': {
        console.log('[Webhook] Meeting complete');

        // Process full transcript for commands
        const transcriptSegments = data.transcript || [];
        const fullText = assembleTranscript(transcriptSegments);

        console.log(`[Webhook] Full transcript: "${normalizeTranscript(fullText)}"`);

        const commands = extractCommands(fullText);
        console.log(`[Webhook] Found ${commands.length} command(s) in transcript`);

        for (const command of commands) {
          await executeCommand(meeting._id.toString(), meeting.companyId, command);
        }

        await MeetingModel.findByIdAndUpdate(meeting._id, {
          status: MEETING_STATUS.ENDED,
          endedAt: new Date(),
        });
        transcriptBuffer.delete(meeting._id.toString());
        break;
      }

      default:
        console.log(`[Webhook] Unhandled event: ${event}`);
    }

    res.sendStatus(200);
  })
);

/**
 * Execute a voice command
 */
async function executeCommand(meetingId: string, companyId: string, command: string): Promise<void> {
  try {
    // Parse the intent
    const intent = await parseIntent(command);
    console.log('[Webhook] Parsed intent:', intent);

    let actionStatus: 'success' | 'failed' | 'clarification_needed' = 'failed';
    let result: string | undefined;
    let errorMessage: string | undefined;

    // Execute based on intent
    switch (intent.action) {
      case INTENTS.POST_MESSAGE: {
        const { channel, message } = intent.params;

        if (!channel || !message) {
          actionStatus = 'clarification_needed';
          break;
        }

        const slack = await SlackService.fromCompanyId(companyId);
        if (!slack) {
          actionStatus = 'failed';
          errorMessage = 'Slack not connected';
          break;
        }

        const slackResult = await slack.postMessage(channel, message);

        if (slackResult.success) {
          actionStatus = 'success';
          result = `Posted "${message}" to #${channel}`;
          console.log(`[Webhook] ${result}`);
        } else {
          actionStatus = 'failed';
          errorMessage = slackResult.error;
        }
        break;
      }

      case INTENTS.CREATE_TASK: {
        const { channel, task } = intent.params;

        if (!channel || !task) {
          actionStatus = 'clarification_needed';
          break;
        }

        const slack = await SlackService.fromCompanyId(companyId);
        if (!slack) {
          actionStatus = 'failed';
          errorMessage = 'Slack not connected';
          break;
        }

        const taskMessage = `:clipboard: *Task Created*\n${task}`;
        const slackResult = await slack.postMessage(channel, taskMessage);

        if (slackResult.success) {
          actionStatus = 'success';
          result = `Created task in #${channel}: ${task}`;
          console.log(`[Webhook] ${result}`);
        } else {
          actionStatus = 'failed';
          errorMessage = slackResult.error;
        }
        break;
      }

      default:
        actionStatus = 'clarification_needed';
    }

    // Log the action
    await ActionLogModel.create({
      meetingId,
      companyId,
      command,
      intent,
      status: actionStatus,
      result,
      errorMessage,
    });
  } catch (error) {
    console.error('[Webhook] Command execution error:', error);

    await ActionLogModel.create({
      meetingId,
      companyId,
      command,
      intent: { action: INTENTS.UNKNOWN, confidence: 0, params: {} },
      status: 'failed',
      errorMessage: error instanceof Error ? error.message : 'Unknown error',
    });
  }
}
