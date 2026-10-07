import { Router, type Router as RouterType } from 'express';
import type { ServerMeta } from '@taro/shared';
import {
  env,
  githubAppConfigured,
  googleCalendarConfigured,
  googleSignInConfigured,
  jiraConfigured,
  linearConfigured,
  serverSttAvailable,
  slackConfigured,
} from '../config/env';
import { calendarInvitesConfigured } from '../lib/inviteAddress';

export const metaRouter: RouterType = Router();

// Public: what this server can offer, so the dashboard hides what isn't set up.
metaRouter.get('/', (_req, res) => {
  const meta: ServerMeta = {
    slackSignIn: slackConfigured(),
    googleSignIn: googleSignInConfigured(),
    githubApp: githubAppConfigured(),
    linear: linearConfigured(),
    jira: jiraConfigured(),
    serverStt: serverSttAvailable(),
    meetExtension: env.extensionIds.length > 0,
    calendarInvites: calendarInvitesConfigured(),
    googleCalendar: googleCalendarConfigured(),
  };
  res.setHeader('Cache-Control', 'public, max-age=60');
  res.json(meta);
});
