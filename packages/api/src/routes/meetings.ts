import { Router, type Router as RouterType } from 'express';
import { isValidObjectId } from 'mongoose';
import { ActionLogModel, CompanyModel, MeetingModel, UserModel } from '../db/models';
import { asyncHandler } from '../middleware/errorHandler';
import { requireAuthOrExtension, webSessionOnly, type AuthedRequest } from '../middleware/auth';
import { NotFoundError, ValidationError } from '../lib/errors';
import { meetLinkFromCode, normalizeMeetingUrl } from '../lib/meetingUrl';
import { rateLimit } from '../lib/rateLimit';
import { log, errorMessage } from '../lib/logger';
import { publicActionLog, publicMeeting } from '../lib/views';
import { launchMeeting, LaunchError } from '../services/meetingLauncher';
import { COPY } from '@taro/shared';
import { MeetingBaasClient, MeetingBaasError } from '../services/meetingbaas';
import { emptyTally, meetingTallies } from '../services/tallies';
import { resolveProviders } from '../services/workspaceProviders';

export const meetingsRouter: RouterType = Router();
// The browser extension's limited session reaches only launch, lookup, and leave; every other route is web only.
meetingsRouter.use(requireAuthOrExtension);

// What the extension sees of a meeting: its state and Taro's last answer, never the transcript.
async function extensionView(meeting: { _id: unknown; status: string; errorMessage?: string }) {
  const last = await ActionLogModel.findOne({ meetingId: String(meeting._id), status: 'success' })
    .sort({ createdAt: -1 })
    .select('summary result');
  // Summaries carry Slack link markup; the extension shows plain text.
  const answer = (last?.summary ?? last?.result ?? '').replace(/<[^|>]+\|([^>]+)>/g, '$1').replace(/:\s*https?:\/\/\S+$/, '.');
  return {
    _id: String(meeting._id),
    status: meeting.status,
    errorMessage: meeting.errorMessage,
    lastAnswer: answer || undefined,
  };
}

// Each launch spends the workspace's own MeetingBaas credits; cap it per workspace.
const launchLimiter = rateLimit({
  windowMs: 60 * 60_000,
  max: 30,
  key: (req) => `launch:${(req as AuthedRequest).companyId}`,
  message: 'Taro has been sent to a lot of meetings in the last hour. Try again later.',
});

async function findOwnMeeting(req: AuthedRequest) {
  if (!isValidObjectId(req.params.id)) throw new NotFoundError('Meeting');
  const meeting = await MeetingModel.findOne({ _id: req.params.id, companyId: req.companyId });
  if (!meeting) throw new NotFoundError('Meeting');
  return meeting;
}

meetingsRouter.get(
  '/',
  webSessionOnly,
  asyncHandler(async (req: AuthedRequest, res) => {
    const archived = req.query.archived === '1';
    const meetings = await MeetingModel.find({
      companyId: req.companyId,
      archivedAt: { $exists: archived },
    })
      .sort({ createdAt: -1 })
      .limit(100);
    // Each row's third line counts how its requests ended. Without the counts the list still renders.
    const ids = meetings.map((m) => m._id.toString());
    const tallies = await meetingTallies(req.companyId!, ids).catch((error) => {
      log.warn('[Meetings] Could not count requests:', errorMessage(error));
      return null;
    });
    res.json({
      meetings: meetings.map((m, i) => publicMeeting(m, tallies ? tallies.get(ids[i]) ?? emptyTally() : undefined)),
    });
  })
);

meetingsRouter.post(
  '/',
  launchLimiter,
  asyncHandler(async (req: AuthedRequest, res) => {
    const body = (req.body ?? {}) as { meetingUrl?: unknown; meetingCode?: unknown };
    const fromExtension = req.sessionKind === 'extension';
    // The extension sends only the code from the Meet address; the link is rebuilt here.
    const link = fromExtension
      ? meetLinkFromCode(body.meetingCode)
      : typeof body.meetingUrl === 'string'
        ? normalizeMeetingUrl(body.meetingUrl)
        : null;
    if (!link) {
      throw new ValidationError(
        fromExtension ? 'That isn’t a Google Meet meeting code.' : 'Paste a Google Meet, Zoom, or Microsoft Teams meeting link.'
      );
    }
    const user = await UserModel.findById(req.userId).select('name');
    try {
      const { meeting, alreadyActive } = await launchMeeting({
        companyId: req.companyId!,
        link,
        source: fromExtension ? 'extension' : 'dashboard',
        startedByName: user?.name,
        startedByUserId: req.userId,
      });
      const view = fromExtension ? await extensionView(meeting) : publicMeeting(meeting);
      res.status(alreadyActive ? 200 : 201).json({ meeting: view, alreadyActive });
    } catch (error) {
      if (error instanceof LaunchError) {
        const status = error.code === 'not_ready' ? 412 : error.code === 'limit' ? 429 : error.code === 'not_found' ? 404 : 502;
        return res.status(status).json({ error: error.message, code: error.code.toUpperCase() });
      }
      throw error;
    }
  })
);

// Archives rather than deletes, so meetings stay visible in the archive view.
meetingsRouter.post(
  '/clear-history',
  webSessionOnly,
  asyncHandler(async (req: AuthedRequest, res) => {
    const result = await MeetingModel.updateMany(
      { companyId: req.companyId, archivedAt: { $exists: false }, status: { $in: ['ended', 'error'] } },
      { archivedAt: new Date() }
    );
    res.json({ archived: result.modifiedCount });
  })
);

// The extension asks what's happening in the call it's showing: the most recent Taro
// meeting for that code in this workspace, from the last few hours.
meetingsRouter.get(
  '/lookup',
  asyncHandler(async (req: AuthedRequest, res) => {
    const link = meetLinkFromCode(req.query.code);
    if (!link) throw new ValidationError('That isn’t a Google Meet meeting code.');
    const meeting = await MeetingModel.findOne({
      companyId: req.companyId,
      meetUrl: link.url,
      createdAt: { $gt: new Date(Date.now() - 3 * 60 * 60 * 1000) },
    }).sort({ createdAt: -1 });
    res.json({ meeting: meeting ? await extensionView(meeting) : null });
  })
);

meetingsRouter.get(
  '/:id',
  webSessionOnly,
  asyncHandler(async (req: AuthedRequest, res) => {
    const meeting = await findOwnMeeting(req);
    const actionLogs = await ActionLogModel.find({ meetingId: meeting._id.toString() })
      .sort({ createdAt: -1 })
      .limit(50);
    res.json({ meeting: { ...publicMeeting(meeting), actionLogs: actionLogs.map(publicActionLog) } });
  })
);

meetingsRouter.post(
  '/:id/leave',
  asyncHandler(async (req: AuthedRequest, res) => {
    const meeting = await findOwnMeeting(req);
    // The extension can only make Taro leave the call its button is sitting in.
    const fromExtension = req.sessionKind === 'extension';
    if (fromExtension && meetLinkFromCode((req.body ?? {}).meetingCode)?.url !== meeting.meetUrl) {
      return res.status(403).json({ error: 'This browser can only remove Taro from the meeting it is in.', code: 'FORBIDDEN' });
    }
    const open = ['pending', 'joining', 'active'].includes(meeting.status);
    // Asked even when the meeting already looks over: the dashboard can be wrong about
    // that (a dropped audio stream), and a bot left behind keeps billing the workspace.
    if (meeting.botId && !meeting.commandsProcessedAt && meeting.status !== 'error') {
      const company = await CompanyModel.findById(req.companyId);
      const key = company ? resolveProviders(company).meetingBaasKey : null;
      // An open meeting only ends here once MeetingBaas confirms the bot is out. Otherwise it
      // stays open, so the person can try again, and it still ends when the bot really leaves.
      if (!key) {
        if (open) return res.status(409).json({ error: COPY.leaveNeedsKey, code: 'NO_MEETING_BOT_KEY' });
      } else {
        try {
          await new MeetingBaasClient(key).leave(meeting.botId);
        } catch (error) {
          const status = error instanceof MeetingBaasError ? error.status : undefined;
          // MeetingBaas no longer having the bot means it's already out of the call.
          if (status !== 404) {
            log.warn(`[Meetings] Leave request failed for ${meeting._id}: ${errorMessage(error)}`);
            if (open) {
              const retryable = status === undefined || status === 429 || status >= 500;
              return res.status(502).json(
                retryable
                  ? { error: COPY.leaveUnconfirmed, code: 'LEAVE_UNCONFIRMED' }
                  : { error: COPY.leaveRefused(errorMessage(error)), code: 'LEAVE_REFUSED' }
              );
            }
          }
        }
      }
    }
    if (open) {
      meeting.status = 'ended';
      meeting.endedAt = new Date();
      await meeting.save();
    }
    res.json({ meeting: fromExtension ? await extensionView(meeting) : publicMeeting(meeting) });
  })
);
