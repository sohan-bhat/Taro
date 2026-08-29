import { Router, type Router as RouterType } from 'express';
import { MeetingModel, ActionLogModel, CompanyModel } from '../db/models';
import { MEETING_STATUS } from '@taro/shared';
import { asyncHandler } from '../middleware/errorHandler';
import { requireAuth, assertCompany, type AuthedRequest } from '../middleware/auth';
import { NotFoundError, ValidationError, ConflictError } from '../lib/errors';
import { getMeetingBaasService } from '../services';
import { env } from '../config/env';

export const meetingsRouter: RouterType = Router();

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

meetingsRouter.get(
  '/',
  requireAuth,
  asyncHandler(async (req: AuthedRequest, res) => {
    const { status, archived } = req.query;

    const filter: Record<string, unknown> = { companyId: req.companyId };
    if (status) filter.status = status;
    // Main history hides archived meetings; the archive view asks for them.
    filter.archivedAt = archived === '1' ? { $exists: true } : { $exists: false };

    const meetings = await MeetingModel.find(filter)
      .sort({ createdAt: -1 })
      .limit(200);
    res.json(meetings);
  })
);

// Archives rather than deletes, so meetings stay visible in the archive view.
meetingsRouter.post(
  '/clear-history',
  requireAuth,
  asyncHandler(async (req: AuthedRequest, res) => {
    const result = await MeetingModel.updateMany(
      { companyId: req.companyId, archivedAt: { $exists: false } },
      { archivedAt: new Date() }
    );
    res.json({ archived: result.modifiedCount });
  })
);

meetingsRouter.get(
  '/:id',
  requireAuth,
  asyncHandler(async (req: AuthedRequest, res) => {
    const meeting = await MeetingModel.findById(req.params.id);
    if (!meeting) {
      throw new NotFoundError('Meeting', req.params.id);
    }
    if (!assertCompany(req, res, meeting.companyId.toString())) return;

    const actionLogs = await ActionLogModel.find({ meetingId: meeting._id })
      .sort({ createdAt: -1 })
      .limit(50);

    res.json({
      ...meeting.toObject(),
      actionLogs,
    });
  })
);

meetingsRouter.post(
  '/',
  asyncHandler(async (req, res) => {
    const { companyId, meetUrl } = req.body;

    if (!companyId || !meetUrl) {
      throw new ValidationError('companyId and meetUrl are required');
    }

    const company = await CompanyModel.findById(companyId);
    if (!company) {
      throw new NotFoundError('Company', companyId);
    }

    if (!isValidMeetUrl(meetUrl)) {
      throw new ValidationError(
        'Invalid Google Meet URL. Expected format: https://meet.google.com/xxx-xxxx-xxx'
      );
    }

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

    const meeting = await MeetingModel.create({
      companyId,
      meetUrl,
      status: MEETING_STATUS.PENDING,
    });

    try {
      const meetingBaas = getMeetingBaasService();
      const webhookUrl = `${env.apiUrl}/api/webhooks/meetingbaas`;

      console.log(`[Meetings] Deploying bot to ${meetUrl}, webhook: ${webhookUrl}`);

      const bot = await meetingBaas.joinMeeting({
        meetingUrl: meetUrl,
        botName: 'Taro Assistant',
        webhookUrl,
        meetingId: meeting._id.toString(),
        publicBaseUrl: env.apiUrl,
      });

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

meetingsRouter.patch(
  '/:id',
  asyncHandler(async (req, res) => {
    const { status } = req.body;

    const validStatuses = Object.values(MEETING_STATUS);
    if (status && !validStatuses.includes(status)) {
      throw new ValidationError(`Invalid status. Must be one of: ${validStatuses.join(', ')}`);
    }

    const updateData: Record<string, unknown> = { status };

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

meetingsRouter.post(
  '/:id/end',
  requireAuth,
  asyncHandler(async (req: AuthedRequest, res) => {
    const meeting = await MeetingModel.findById(req.params.id);

    if (!meeting) {
      throw new NotFoundError('Meeting', req.params.id);
    }
    if (!assertCompany(req, res, meeting.companyId.toString())) return;

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
