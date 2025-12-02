import { Router, type Router as RouterType } from 'express';
import { MeetingModel, ActionLogModel, CompanyModel } from '../db/models';
import { MEETING_STATUS } from '@taro/shared';
import { asyncHandler } from '../middleware/errorHandler';
import { NotFoundError, ValidationError, ConflictError } from '../lib/errors';
import { getMeetingBaasService } from '../services';
import { env } from '../config/env';

export const meetingsRouter: RouterType = Router();

// Validate Google Meet URL format
function isValidMeetUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    return (
      parsed.hostname === 'meet.google.com' &&
      /^\/[a-z]{3}-[a-z]{4}-[a-z]{3}$/.test(parsed.pathname)
    );
  } catch {
    return false;
  }
}

// Get pending meetings (for bot to poll) - must be before /:id route
meetingsRouter.get(
  '/pending/all',
  asyncHandler(async (req, res) => {
    const meetings = await MeetingModel.find({
      status: MEETING_STATUS.PENDING,
    })
      .sort({ createdAt: 1 })
      .limit(10);

    res.json(meetings);
  })
);

// Get all meetings for a company
meetingsRouter.get(
  '/',
  asyncHandler(async (req, res) => {
    const { companyId, status } = req.query;

    const filter: Record<string, unknown> = {};
    if (companyId) filter.companyId = companyId;
    if (status) filter.status = status;

    const meetings = await MeetingModel.find(filter)
      .sort({ createdAt: -1 })
      .limit(100);
    res.json(meetings);
  })
);

// Get meeting by ID with action logs
meetingsRouter.get(
  '/:id',
  asyncHandler(async (req, res) => {
    const meeting = await MeetingModel.findById(req.params.id);
    if (!meeting) {
      throw new NotFoundError('Meeting', req.params.id);
    }

    const actionLogs = await ActionLogModel.find({ meetingId: meeting._id })
      .sort({ createdAt: -1 })
      .limit(50);

    res.json({
      ...meeting.toObject(),
      actionLogs,
    });
  })
);

// Create meeting (request bot to join)
meetingsRouter.post(
  '/',
  asyncHandler(async (req, res) => {
    const { companyId, meetUrl } = req.body;

    if (!companyId || !meetUrl) {
      throw new ValidationError('companyId and meetUrl are required');
    }

    // Validate company exists
    const company = await CompanyModel.findById(companyId);
    if (!company) {
      throw new NotFoundError('Company', companyId);
    }

    // Validate Google Meet URL format
    if (!isValidMeetUrl(meetUrl)) {
      throw new ValidationError(
        'Invalid Google Meet URL. Expected format: https://meet.google.com/xxx-xxxx-xxx'
      );
    }

    // Check for existing active meeting with same URL
    const existingMeeting = await MeetingModel.findOne({
      companyId,
      meetUrl,
      status: {
        $in: [
          MEETING_STATUS.PENDING,
          MEETING_STATUS.JOINING,
          MEETING_STATUS.ACTIVE,
        ],
      },
    });

    if (existingMeeting) {
      throw new ConflictError('Bot is already in or joining this meeting');
    }

    // Create meeting record
    const meeting = await MeetingModel.create({
      companyId,
      meetUrl,
      status: MEETING_STATUS.PENDING,
    });

    // Deploy bot via MeetingBaas
    try {
      const meetingBaas = getMeetingBaasService();
      const webhookUrl = `${env.apiUrl}/api/webhooks/meetingbaas`;

      console.log(`[Meetings] Deploying bot to ${meetUrl}, webhook: ${webhookUrl}`);

      const bot = await meetingBaas.joinMeeting({
        meetingUrl: meetUrl,
        botName: 'Taro Assistant',
        webhookUrl,
      });

      // Update meeting with bot ID
      meeting.botId = bot.bot_id;
      meeting.status = MEETING_STATUS.JOINING;
      await meeting.save();

      console.log(`[Meetings] Bot deployed: ${bot.bot_id}`);
    } catch (error) {
      console.error('[Meetings] Failed to deploy bot:', error);
      meeting.status = MEETING_STATUS.ERROR;
      await meeting.save();
    }

    res.status(201).json(meeting);
  })
);

// Update meeting status
meetingsRouter.patch(
  '/:id',
  asyncHandler(async (req, res) => {
    const { status } = req.body;

    const validStatuses = Object.values(MEETING_STATUS);
    if (status && !validStatuses.includes(status)) {
      throw new ValidationError(`Invalid status. Must be one of: ${validStatuses.join(', ')}`);
    }

    const updateData: Record<string, unknown> = { status };

    // Set timestamps based on status
    if (status === MEETING_STATUS.ACTIVE) {
      updateData.startedAt = new Date();
    } else if (status === MEETING_STATUS.ENDED) {
      updateData.endedAt = new Date();
    }

    const meeting = await MeetingModel.findByIdAndUpdate(
      req.params.id,
      updateData,
      { new: true }
    );

    if (!meeting) {
      throw new NotFoundError('Meeting', req.params.id);
    }

    res.json(meeting);
  })
);

// End meeting
meetingsRouter.post(
  '/:id/end',
  asyncHandler(async (req, res) => {
    const meeting = await MeetingModel.findById(req.params.id);

    if (!meeting) {
      throw new NotFoundError('Meeting', req.params.id);
    }

    // Remove bot from meeting via MeetingBaas
    if (meeting.botId) {
      try {
        const meetingBaas = getMeetingBaasService();
        await meetingBaas.leaveBot(meeting.botId);
        console.log(`[Meetings] Bot ${meeting.botId} left the meeting`);
      } catch (error) {
        console.error('[Meetings] Failed to remove bot:', error);
      }
    }

    meeting.status = MEETING_STATUS.ENDED;
    meeting.endedAt = new Date();
    await meeting.save();

    res.json(meeting);
  })
);
