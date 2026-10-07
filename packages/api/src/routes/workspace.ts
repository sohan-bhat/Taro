import { Router, type Router as RouterType } from 'express';
import { isValidObjectId } from 'mongoose';
import type { WorkspaceOverview, WorkspaceRole } from '@taro/shared';
import { DEFAULT_GITHUB_ACTIONS, isTrackerId } from '@taro/shared';
import {
  ActionLogModel,
  CompanyModel,
  GithubConnectionModel,
  GithubGrantModel,
  GoogleCalendarConnectionModel,
  JiraConnectionModel,
  LinearConnectionModel,
  LoginCodeModel,
  MeetingModel,
  SessionModel,
  SlackConnectionModel,
  UserModel,
} from '../db/models';
import { githubAppConfigured, googleCalendarConfigured } from '../config/env';
import { asyncHandler } from '../middleware/errorHandler';
import { requireAdmin, requireAuth, requireOwner, type AuthedRequest } from '../middleware/auth';
import { NotFoundError, ValidationError } from '../lib/errors';
import { publicUser, publicWorkspace } from '../lib/views';
import { log, errorMessage } from '../lib/logger';
import { providerReadiness, providerSettings } from '../services/workspaceProviders';
import { readSlackToken } from '../services/slack';
import { forgetWorkspace } from '../services/calendar/invitations';
import { calendarStatus, forgetCalendars } from '../services/calendar/googleConnect';
import { forgetTrackers, jiraStatus, linearStatus } from '../services/trackers/status';
import { WebClient } from '@slack/web-api';

export const workspaceRouter: RouterType = Router();
workspaceRouter.use(requireAuth);

workspaceRouter.get(
  '/',
  asyncHandler(async (req: AuthedRequest, res) => {
    const [company, me, slack, github, calendar, linear, jira] = await Promise.all([
      CompanyModel.findById(req.companyId),
      UserModel.findById(req.userId),
      SlackConnectionModel.findOne({ companyId: req.companyId }),
      GithubConnectionModel.findOne({ companyId: req.companyId }),
      GoogleCalendarConnectionModel.findOne({ companyId: req.companyId, userId: req.userId }),
      LinearConnectionModel.findOne({ companyId: req.companyId }),
      JiraConnectionModel.findOne({ companyId: req.companyId }),
    ]);
    if (!company || !me) throw new NotFoundError('Workspace');

    const githubLive = !!github?.installationId && !github.disconnectedAt;
    const readiness = providerReadiness(company);
    const overview: WorkspaceOverview = {
      workspace: publicWorkspace(company),
      me: publicUser(me),
      providers: providerSettings(company),
      slack: {
        connected: !!slack,
        teamName: slack?.teamName,
        connectedAt: slack?.createdAt?.toISOString(),
      },
      github: {
        connected: githubLive,
        configured: githubAppConfigured(),
        accountLogin: githubLive ? github?.accountLogin : undefined,
        repo: githubLive ? github?.repo : undefined,
        needsRepo: githubLive && !github?.repo,
        // undefined means the workspace never chose, so the safe defaults apply
        enabledActions: githubLive ? (github?.enabledActions ? [...github.enabledActions] : DEFAULT_GITHUB_ACTIONS) : undefined,
        reconnectable: !!github?.installationId && !!github.disconnectedAt,
        connectedAt: githubLive ? github?.createdAt?.toISOString() : undefined,
      },
      linear: linearStatus(linear),
      jira: jiraStatus(jira),
      ...(company.ticketTracker ? { ticketTracker: company.ticketTracker } : {}),
      // The signed-in person's own calendar, or one they connected before the server stopped offering it
      ...(googleCalendarConfigured() || calendar ? { googleCalendar: calendarStatus(calendar) } : {}),
      ready: {
        ...readiness,
        slack: !!slack,
        canJoinMeetings: readiness.meetingBot && readiness.llm && readiness.stt,
      },
    };
    res.json(overview);
  })
);

workspaceRouter.patch(
  '/',
  requireAdmin,
  asyncHandler(async (req: AuthedRequest, res) => {
    const update: Record<string, string> = {};
    const { name, botName } = (req.body ?? {}) as { name?: unknown; botName?: unknown };
    if (name !== undefined) {
      if (typeof name !== 'string' || !name.trim() || name.trim().length > 80) {
        throw new ValidationError('Workspace name must be 1 to 80 characters.');
      }
      update.name = name.trim();
    }
    if (botName !== undefined) {
      if (typeof botName !== 'string' || !botName.trim() || botName.trim().length > 40) {
        throw new ValidationError('Bot name must be 1 to 40 characters.');
      }
      update.botName = botName.trim();
    }
    const company = await CompanyModel.findByIdAndUpdate(req.companyId, update, { new: true });
    if (!company) throw new NotFoundError('Workspace');
    res.json({ workspace: publicWorkspace(company) });
  })
);

// With Linear and Jira both connected: where a ticket goes when nobody says which.
workspaceRouter.put(
  '/ticket-tracker',
  requireAdmin,
  asyncHandler(async (req: AuthedRequest, res) => {
    const tracker = (req.body ?? {}).tracker;
    if (!isTrackerId(tracker)) throw new ValidationError('Choose Linear or Jira.');
    const company = await CompanyModel.findByIdAndUpdate(req.companyId, { ticketTracker: tracker }, { new: true });
    if (!company) throw new NotFoundError('Workspace');
    res.json({ ticketTracker: company.ticketTracker });
  })
);

workspaceRouter.post(
  '/onboarding-complete',
  requireAdmin,
  asyncHandler(async (req: AuthedRequest, res) => {
    const company = await CompanyModel.findByIdAndUpdate(req.companyId, { onboardedAt: new Date() }, { new: true });
    if (!company) throw new NotFoundError('Workspace');
    res.json({ workspace: publicWorkspace(company) });
  })
);

async function findMember(req: AuthedRequest) {
  if (!isValidObjectId(req.params.userId)) throw new NotFoundError('Member');
  const target = await UserModel.findOne({ _id: req.params.userId, companyId: req.companyId });
  if (!target) throw new NotFoundError('Member');
  return target;
}

async function hasOwner(companyId: string): Promise<boolean> {
  return !!(await UserModel.exists({ companyId, role: 'owner', removedAt: { $exists: false } }));
}

workspaceRouter.get(
  '/members',
  asyncHandler(async (req: AuthedRequest, res) => {
    const users = await UserModel.find({ companyId: req.companyId }).sort({ createdAt: 1 }).limit(500);
    res.json({ members: users.map(publicUser) });
  })
);

workspaceRouter.patch(
  '/members/:userId',
  requireOwner,
  asyncHandler(async (req: AuthedRequest, res) => {
    const role = (req.body ?? {}).role as WorkspaceRole;
    if (!['owner', 'admin', 'member'].includes(role)) {
      throw new ValidationError('Role must be owner, admin, or member.');
    }
    const target = await findMember(req);
    if (target.removedAt) throw new ValidationError('Restore them first.');
    const wasOwner = target.role === 'owner';
    target.role = role;
    await target.save();
    // Checked after the write, so two owners demoting each other at once can't leave none
    if (wasOwner && role !== 'owner' && !(await hasOwner(req.companyId!))) {
      target.role = 'owner';
      await target.save();
      throw new ValidationError('Make someone else an owner first.');
    }
    res.json({ member: publicUser(target) });
  })
);

// Signs them out everywhere and keeps them out, even though Slack would still let them in.
workspaceRouter.delete(
  '/members/:userId',
  requireOwner,
  asyncHandler(async (req: AuthedRequest, res) => {
    const target = await findMember(req);
    const wasOwner = target.role === 'owner';
    target.removedAt = new Date();
    target.role = 'member';
    await target.save();
    if (wasOwner && !(await hasOwner(req.companyId!))) {
      target.removedAt = undefined;
      target.role = 'owner';
      await target.save();
      throw new ValidationError('Make someone else an owner first.');
    }
    await SessionModel.deleteMany({ userId: target._id.toString() });
    log.info(`[Workspace] ${req.userId} removed member ${target._id} from ${req.companyId}`);
    res.json({ member: publicUser(target) });
  })
);

workspaceRouter.post(
  '/members/:userId/restore',
  requireOwner,
  asyncHandler(async (req: AuthedRequest, res) => {
    const target = await findMember(req);
    target.removedAt = undefined;
    await target.save();
    res.json({ member: publicUser(target) });
  })
);

// Permanently removes the workspace and everything Taro stored for it.
workspaceRouter.delete(
  '/',
  requireOwner,
  asyncHandler(async (req: AuthedRequest, res) => {
    const companyId = req.companyId!;
    const slack = await SlackConnectionModel.findOne({ companyId });
    if (slack) {
      // Revoke the bot token so the Slack app stops working there too
      try {
        await new WebClient(readSlackToken(slack)).auth.revoke();
      } catch (error) {
        log.warn('[Workspace] Slack token revoke failed during delete:', errorMessage(error));
      }
    }
    // Connected calendars first, so no read adds meetings back, revoking each grant at Google
    await forgetCalendars(companyId).catch((error) => log.warn('[Workspace] Google Calendar cleanup failed during delete:', errorMessage(error)));
    // Linear's token is revoked at Linear; the Jira key is just forgotten
    await forgetTrackers(companyId).catch((error) => log.warn('[Workspace] Linear and Jira cleanup failed during delete:', errorMessage(error)));
    // Calendar meetings next, while the MeetingBaas key is still there to cancel their scheduled bots
    await forgetWorkspace(companyId).catch((error) => log.warn('[Workspace] Calendar cleanup failed during delete:', errorMessage(error)));
    await Promise.all([
      MeetingModel.deleteMany({ companyId }),
      ActionLogModel.deleteMany({ companyId }),
      SlackConnectionModel.deleteMany({ companyId }),
      GithubConnectionModel.deleteMany({ companyId }),
      GithubGrantModel.deleteMany({ companyId }),
      SessionModel.deleteMany({ companyId }),
      LoginCodeModel.deleteMany({ companyId }),
      UserModel.deleteMany({ companyId }),
    ]);
    await CompanyModel.deleteOne({ _id: companyId });
    log.info(`[Workspace] Deleted workspace ${companyId}`);
    res.status(204).end();
  })
);
