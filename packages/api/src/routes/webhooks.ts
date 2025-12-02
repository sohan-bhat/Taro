/**
 * Webhook endpoints for receiving data from external services.
 * Currently handles MeetingBaas transcription webhooks.
 */

import { Router, type Router as RouterType } from 'express';
import { MeetingModel, ActionLogModel } from '../db/models';
import { SlackService, parseIntent } from '../services';
import { WAKE_WORD, INTENTS, TTS_RESPONSES, MEETING_STATUS } from '@taro/shared';
import { asyncHandler } from '../middleware/errorHandler';

export const webhooksRouter: RouterType = Router();

// Buffer to accumulate transcript text per meeting (for wake word detection across chunks)
const transcriptBuffer: Map<string, string> = new Map();

/**
 * MeetingBaas webhook endpoint
 * Receives events: bot.status_change, transcript, complete
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

      case 'transcript': {
        // Handle real-time transcription
        const transcript = data.transcript || data.text || '';
        const speaker = data.speaker || 'Unknown';

        console.log(`[Webhook] Transcript from ${speaker}: "${transcript}"`);

        // Accumulate transcript in buffer
        const meetingId = meeting._id.toString();
        const currentBuffer = transcriptBuffer.get(meetingId) || '';
        const newBuffer = (currentBuffer + ' ' + transcript).toLowerCase().trim();

        // Keep buffer size reasonable (last ~500 chars)
        const trimmedBuffer = newBuffer.slice(-500);
        transcriptBuffer.set(meetingId, trimmedBuffer);

        // Check for wake word
        if (trimmedBuffer.includes(WAKE_WORD)) {
          // Extract command after wake word
          const wakeWordIndex = trimmedBuffer.lastIndexOf(WAKE_WORD);
          const commandText = trimmedBuffer.slice(wakeWordIndex + WAKE_WORD.length).trim();

          if (commandText && commandText.length > 3) {
            console.log(`[Webhook] Wake word detected! Command: "${commandText}"`);

            // Clear buffer after wake word to prevent re-triggering
            transcriptBuffer.set(meetingId, '');

            // Execute the command
            await executeCommand(meeting._id.toString(), meeting.companyId, commandText);
          }
        }
        break;
      }

      case 'complete': {
        console.log('[Webhook] Meeting complete');

        // Process full transcript for commands
        const transcriptSegments = data.transcript || [];
        const fullText = transcriptSegments
          .map((segment: { words?: Array<{ word: string }> }) =>
            segment.words?.map((w) => w.word).join('') || ''
          )
          .join(' ')
          .toLowerCase();

        console.log(`[Webhook] Full transcript: "${fullText}"`);

        // Look for wake word variations (hey taro, hey tara, etc.)
        const wakeWordVariations = ['hey taro', 'hey tara', 'hey tarro', 'a taro', 'a tara'];
        let command = '';

        for (const wakeWord of wakeWordVariations) {
          if (fullText.includes(wakeWord)) {
            const wakeWordIndex = fullText.lastIndexOf(wakeWord);
            command = fullText.slice(wakeWordIndex + wakeWord.length).trim();
            console.log(`[Webhook] Wake word "${wakeWord}" detected! Command: "${command}"`);
            break;
          }
        }

        // Execute command if found
        if (command && command.length > 3) {
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

        const taskMessage = `📋 **Task Created**\n${task}`;
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
