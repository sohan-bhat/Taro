/**
 * Connect Google Calendar: each member connects their own calendar, read only, and Taro joins the
 * meetings on it. Everything here is about the signed-in person's own connection, so members, admins,
 * and owners use it alike. The notify route is Google's: it's public, and each notice is checked
 * against its channel's own token before anything happens.
 */

import { Router, type NextFunction, type Request, type Response, type Router as RouterType } from 'express';
import type { GoogleCalendarJoinMode } from '@taro/shared';
import { GoogleCalendarConnectionModel, UserModel } from '../db/models';
import { googleCalendarConfigured } from '../config/env';
import { asyncHandler } from '../middleware/errorHandler';
import { requireAuth, type AuthedRequest } from '../middleware/auth';
import { ValidationError } from '../lib/errors';
import { resolveReturnTo } from '../lib/origins';
import { rateLimit } from '../lib/rateLimit';
import { emailFrom } from '../services/calendar/ics';
import { connectUrl, disconnect, finishConsent, redeemGrant, statusFor, updateSettings, type CalendarState } from '../services/calendar/googleConnect';
import { channelNotified } from '../services/calendar/googleSync';

export const googleCalendarRouter: RouterType = Router();

const perPerson = rateLimit({
  windowMs: 60_000,
  max: 20,
  key: (req) => `google-calendar:${(req as AuthedRequest).userId}`,
  message: 'That was a lot of changes to your calendar connection. Try again in a minute.',
});
// Google sends one notice per change, from many addresses; this only damps a flood.
const notifyLimiter = rateLimit({ windowMs: 60_000, max: 600 });

function configured(_req: Request, res: Response, next: NextFunction) {
  if (googleCalendarConfigured()) return next();
  res.status(404).json({ error: "Google Calendar isn't set up on this Taro server.", code: 'NOT_CONFIGURED' });
}

googleCalendarRouter.get(
  '/',
  requireAuth,
  configured,
  asyncHandler(async (req: AuthedRequest, res) => {
    res.json({ calendar: await statusFor(req.companyId!, req.userId!) });
  })
);

googleCalendarRouter.post(
  '/connect-url',
  requireAuth,
  configured,
  perPerson,
  asyncHandler(async (req: AuthedRequest, res) => {
    const [me, existing] = await Promise.all([
      UserModel.findById(req.userId).select('email'),
      GoogleCalendarConnectionModel.findOne({ companyId: req.companyId, userId: req.userId }).select('email'),
    ]);
    // Preselects the account: the one already connected, or the one they sign in with
    const loginHint = emailFrom(existing?.email) ?? emailFrom(me?.email);
    const url = connectUrl({ companyId: req.companyId!, userId: req.userId!, loginHint }, resolveReturnTo((req.body ?? {}).returnTo));
    res.json({ url });
  })
);

// Redeems the grant the callback parked. Only the person who started connecting can.
googleCalendarRouter.post(
  '/connect',
  requireAuth,
  configured,
  perPerson,
  asyncHandler(async (req: AuthedRequest, res) => {
    const token = (req.body ?? {}).token;
    if (typeof token !== 'string' || !token || token.length > 128) {
      throw new ValidationError('That Google Calendar connection expired. Connect again.');
    }
    res.json({ calendar: await redeemGrant(req.companyId!, req.userId!, token) });
  })
);

googleCalendarRouter.patch(
  '/',
  requireAuth,
  configured,
  perPerson,
  asyncHandler(async (req: AuthedRequest, res) => {
    const { autoJoin, joinMode } = (req.body ?? {}) as { autoJoin?: unknown; joinMode?: unknown };
    const changes: { autoJoin?: boolean; joinMode?: GoogleCalendarJoinMode } = {};
    if (autoJoin !== undefined) {
      if (typeof autoJoin !== 'boolean') throw new ValidationError('autoJoin must be true or false.');
      changes.autoJoin = autoJoin;
    }
    if (joinMode !== undefined) {
      if (joinMode !== 'all' && joinMode !== 'organizer') throw new ValidationError('joinMode must be all or organizer.');
      changes.joinMode = joinMode;
    }
    if (Object.keys(changes).length === 0) throw new ValidationError('Nothing to change.');
    res.json({ calendar: await updateSettings(req.companyId!, req.userId!, changes) });
  })
);

// Works even after the server stops offering Google Calendar, so nobody is stuck with a connection.
googleCalendarRouter.delete(
  '/',
  requireAuth,
  perPerson,
  asyncHandler(async (req: AuthedRequest, res) => {
    await disconnect(req.companyId!, req.userId!);
    res.json({ calendar: { connected: false } });
  })
);

googleCalendarRouter.post(
  '/notify',
  notifyLimiter,
  asyncHandler(async (req, res) => {
    const header = (name: string, max: number) => {
      const value = req.header(name);
      return typeof value === 'string' && value.length <= max ? value : '';
    };
    const notice = {
      channelId: header('x-goog-channel-id', 64),
      token: header('x-goog-channel-token', 256),
      resourceId: header('x-goog-resource-id', 256),
      state: header('x-goog-resource-state', 32),
    };
    if (!notice.channelId || !notice.token || !notice.resourceId) return res.status(400).end();
    // The same answer whether Taro knew the channel or not
    await channelNotified(notice);
    res.status(204).end();
  })
);

/** The shared Google callback, for a state that says it's connecting a calendar: back to Setup with a grant or an error. */
export async function finishCalendarCallback(req: Request, res: Response, state: CalendarState, stateParam: string): Promise<void> {
  // Re-checked against the allowlist even though it was signed, in case the allowlist changed
  const returnTo = resolveReturnTo(state.r);
  const outcome = await finishConsent(state, stateParam, req.query);
  const query: Record<string, string> = 'grant' in outcome ? { calendarConnect: outcome.grant } : { error: outcome.error };
  res.redirect(`${returnTo}/dashboard?${new URLSearchParams(query)}`);
}
