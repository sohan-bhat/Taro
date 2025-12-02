import { Router, type Router as RouterType } from 'express';
import { ActionLogModel, MeetingModel } from '../db/models';
import { SlackService, parseIntent, extractCommand } from '../services';
import { INTENTS, TTS_RESPONSES } from '@taro/shared';
import { asyncHandler } from '../middleware/errorHandler';
import { NotFoundError, ValidationError } from '../lib/errors';

export const commandsRouter: RouterType = Router();

// Execute a command from the meeting bot
commandsRouter.post('/execute', async (req, res) => {
  const { meetingId, companyId, command } = req.body;

  if (!meetingId || !companyId || !command) {
    return res.status(400).json({ error: 'meetingId, companyId, and command are required' });
  }

  try {
    // Verify meeting exists
    const meeting = await MeetingModel.findById(meetingId);
    if (!meeting) {
      return res.status(404).json({ error: 'Meeting not found' });
    }

    // Parse the intent
    const intent = await parseIntent(command);
    console.log('Parsed intent:', intent);

    let actionStatus: 'success' | 'failed' | 'clarification_needed' = 'failed';
    let result: string | undefined;
    let errorMessage: string | undefined;
    let ttsMessage: string;

    // Execute based on intent
    switch (intent.action) {
      case INTENTS.POST_MESSAGE: {
        const { channel, message } = intent.params;

        if (!channel || !message) {
          actionStatus = 'clarification_needed';
          ttsMessage = "I couldn't understand the channel or message. Could you try again?";
          break;
        }

        // Get Slack service
        const slack = await SlackService.fromCompanyId(companyId);
        if (!slack) {
          actionStatus = 'failed';
          errorMessage = 'Slack not connected';
          ttsMessage = "Slack isn't connected for this company. Please connect Slack first.";
          break;
        }

        // Post message
        const slackResult = await slack.postMessage(channel, message);

        if (slackResult.success) {
          actionStatus = 'success';
          result = `Posted "${message}" to #${channel}`;
          ttsMessage = TTS_RESPONSES.SLACK_SUCCESS(channel);
        } else {
          actionStatus = 'failed';
          errorMessage = slackResult.error;
          ttsMessage = `Sorry, I couldn't post to ${channel}. ${slackResult.error}`;
        }
        break;
      }

      case INTENTS.CREATE_TASK: {
        const { channel, task } = intent.params;

        if (!channel || !task) {
          actionStatus = 'clarification_needed';
          ttsMessage = "I couldn't understand the channel or task. Could you try again?";
          break;
        }

        // For MVP, create task as a message (TODO: integrate with actual task systems)
        const slack = await SlackService.fromCompanyId(companyId);
        if (!slack) {
          actionStatus = 'failed';
          errorMessage = 'Slack not connected';
          ttsMessage = "Slack isn't connected. Please connect Slack first.";
          break;
        }

        const taskMessage = `📋 **Task Created**\n${task}`;
        const slackResult = await slack.postMessage(channel, taskMessage);

        if (slackResult.success) {
          actionStatus = 'success';
          result = `Created task in #${channel}: ${task}`;
          ttsMessage = TTS_RESPONSES.TASK_SUCCESS(channel);
        } else {
          actionStatus = 'failed';
          errorMessage = slackResult.error;
          ttsMessage = `Sorry, I couldn't create the task. ${slackResult.error}`;
        }
        break;
      }

      case INTENTS.UNKNOWN:
      default: {
        actionStatus = 'clarification_needed';
        ttsMessage = "I'm not sure what you want me to do. Try saying something like 'post hello to general'.";
        break;
      }
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

    res.json({
      success: actionStatus === 'success',
      intent,
      result,
      errorMessage,
      ttsMessage,
    });
  } catch (error) {
    console.error('Command execution error:', error);

    // Log the failure
    await ActionLogModel.create({
      meetingId,
      companyId,
      command,
      intent: { action: INTENTS.UNKNOWN, confidence: 0, params: {} },
      status: 'failed',
      errorMessage: error instanceof Error ? error.message : 'Unknown error',
    });

    res.status(500).json({
      success: false,
      error: 'Command execution failed',
      ttsMessage: TTS_RESPONSES.ERROR,
    });
  }
});

// Get action logs for a meeting
commandsRouter.get('/logs/:meetingId', async (req, res) => {
  try {
    const logs = await ActionLogModel.find({ meetingId: req.params.meetingId })
      .sort({ createdAt: -1 })
      .limit(50);

    res.json(logs);
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch logs' });
  }
});
