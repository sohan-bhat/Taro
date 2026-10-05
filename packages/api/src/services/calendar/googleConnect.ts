/**
 * Connecting a member's own Google Calendar, read only, on the same Google client as sign-in and its
 * already registered redirect URI. The OAuth state's type tells the shared callback this is a calendar
 * connection, not a sign-in. Connecting takes two steps, like GitHub's:
 *
 *  1. The callback checks that Google granted reading calendar events, and parks the refresh token,
 *     encrypted for the person who started, as a short-lived grant. It connects nothing.
 *  2. The dashboard redeems the grant with that same person's session. A consent link someone sends
 *     to another person, or that finishes in another browser, connects nothing.
 *
 * Taro never asks to change a calendar and never acts as the person.
 */

import type { GoogleCalendarJoinMode, GoogleCalendarStatus } from '@taro/shared';
import { GoogleCalendarConnectionModel, GoogleCalendarGrantModel } from '../../db/models';
import type { GoogleCalendarConnectionDoc } from '../../db/models/GoogleCalendarConnection';
import { env, googleCalendarConfigured } from '../../config/env';
import { decryptSecret, encryptSecret, randomToken, sha256, signToken, verifyToken } from '../../lib/crypto';
import { NotFoundError, ValidationError } from '../../lib/errors';
import { log, errorMessage } from '../../lib/logger';
import { checkGoogleIdToken, decodeJwtPayload, oidcNonce } from '../../lib/oidc';
import { syncInBackground } from './bots';
import { CONNECT_SCOPES, exchangeCode, hasCalendarScope, redirectUri, revokeToken, stopChannel, type CodeExchange } from './googleApi';
import { accessTokenFor, forgetAccessToken, kickGoogleSync, refreshTokenContext, releaseAll } from './googleSync';

// Its own type, so a sign-in state can't finish a calendar connection or the other way around
export const CALENDAR_STATE = 'calendar:google';
const STATE_TTL_S = 10 * 60;
const GRANT_TTL_MS = 15 * 60_000;
const AUTHORIZE_URL = 'https://accounts.google.com/o/oauth2/v2/auth';

export interface CalendarState {
  // Workspace, person, and where the dashboard is
  c: string;
  u: string;
  r: string;
}

/** Where "Connect Google Calendar" sends the browser. */
export function connectUrl(person: { companyId: string; userId: string; loginHint?: string }, returnTo: string): string {
  const state = signToken(CALENDAR_STATE, { c: person.companyId, u: person.userId, r: returnTo }, STATE_TTL_S);
  const params = new URLSearchParams({
    response_type: 'code',
    client_id: env.googleClientId,
    redirect_uri: redirectUri(),
    scope: CONNECT_SCOPES.join(' '),
    // A refresh token, so Taro can read the calendar between visits, and the consent screen every time, so one always comes back
    access_type: 'offline',
    prompt: 'consent',
    include_granted_scopes: 'true',
    state,
    nonce: oidcNonce(state),
  });
  if (person.loginHint) params.set('login_hint', person.loginHint);
  return `${AUTHORIZE_URL}?${params}`;
}

export const calendarState = (state: string) => verifyToken<CalendarState & Record<string, unknown>>(CALENDAR_STATE, state);

export type ConsentOutcome = { grant: string } | { error: 'calendar_denied' | 'calendar_scope' | 'calendar_unavailable' | 'calendar_failed' };

/**
 * What came back from Google's consent screen: an error, or a code to trade. Checks that the calendar
 * scope was really granted (people can untick it), and parks the result for the dashboard to redeem.
 */
export async function finishConsent(
  state: CalendarState,
  stateParam: string,
  query: { code?: unknown; error?: unknown },
  now = new Date()
): Promise<ConsentOutcome> {
  if (typeof query.error === 'string') return { error: query.error === 'access_denied' ? 'calendar_denied' : 'calendar_failed' };
  if (!googleCalendarConfigured()) return { error: 'calendar_unavailable' };
  const code = typeof query.code === 'string' ? query.code : '';
  if (!code) return { error: 'calendar_failed' };

  let tokens: CodeExchange;
  try {
    tokens = await exchangeCode(code);
  } catch (error) {
    log.warn('[Calendar] Connecting a Google Calendar failed:', errorMessage(error));
    return { error: 'calendar_failed' };
  }
  // Whatever goes wrong from here, Taro lets go of the grant rather than leave one at Google it can't use.
  const letGo = () => revokeToken(tokens.refreshToken ?? tokens.accessToken).catch(() => {});
  if (!hasCalendarScope(tokens.scope)) {
    await letGo();
    return { error: 'calendar_scope' };
  }
  try {
    if (!tokens.idToken || !tokens.refreshToken) throw new Error('Google sent no ID token or refresh token');
    const account = checkGoogleIdToken(decodeJwtPayload(tokens.idToken), { clientId: env.googleClientId, nonce: oidcNonce(stateParam) });
    const grant = randomToken(24);
    await GoogleCalendarGrantModel.create({
      tokenHash: sha256(grant),
      companyId: state.c,
      userId: state.u,
      email: account.email.toLowerCase().slice(0, 254),
      googleSub: account.sub.slice(0, 255),
      refreshTokenEnc: encryptSecret(tokens.refreshToken, refreshTokenContext(state.c, state.u)),
      expiresAt: new Date(now.getTime() + GRANT_TTL_MS),
    });
    return { grant };
  } catch (error) {
    await letGo();
    log.warn('[Calendar] Connecting a Google Calendar failed:', errorMessage(error));
    return { error: 'calendar_failed' };
  }
}

const iso = (d?: Date) => (d ? d.toISOString() : undefined);

type StatusFields = Pick<GoogleCalendarConnectionDoc, 'status' | 'email' | 'createdAt' | 'lastSyncedAt' | 'autoJoin' | 'joinMode'>;

export function calendarStatus(conn: StatusFields | null): GoogleCalendarStatus {
  if (!conn) return { connected: false };
  return {
    connected: true,
    ...(conn.status === 'reconnect' ? { needsReconnect: true } : {}),
    email: conn.email,
    connectedAt: iso(conn.createdAt),
    lastSyncedAt: iso(conn.lastSyncedAt),
    autoJoin: conn.autoJoin,
    joinMode: conn.joinMode,
  };
}

export async function statusFor(companyId: string, userId: string): Promise<GoogleCalendarStatus> {
  return calendarStatus(await GoogleCalendarConnectionModel.findOne({ companyId, userId }));
}

/** Connects the calendar a grant holds, for the person who started it. Reconnecting keeps their setting. */
export async function redeemGrant(companyId: string, userId: string, token: string, now = new Date()): Promise<GoogleCalendarStatus> {
  // Same workspace and the same person: a grant that reached anyone else's session is useless to them.
  const grant = await GoogleCalendarGrantModel.findOneAndDelete({ tokenHash: sha256(token), companyId, userId, expiresAt: { $gt: now } });
  if (!grant) throw new ValidationError('That Google Calendar connection expired or was started by someone else. Connect again.');

  const previous = await GoogleCalendarConnectionModel.findOne({ companyId, userId }).select('+refreshTokenEnc');
  const conn = await GoogleCalendarConnectionModel.findOneAndUpdate(
    { companyId, userId },
    {
      $set: { email: grant.email, googleSub: grant.googleSub, refreshTokenEnc: grant.refreshTokenEnc, status: 'active', nextSyncAt: now },
      $unset: { syncFailures: 1, syncLeaseUntil: 1, channel: 1, channelRetryAt: 1 },
      $setOnInsert: { companyId, userId, autoJoin: true, joinMode: 'all' },
    },
    { upsert: true, new: true }
  );
  forgetAccessToken(String(conn._id));
  log.info(`[Calendar] User ${userId} ${previous ? 'reconnected' : 'connected'} their Google Calendar`);
  // A channel the old grant opened would keep notifying for days; it closes with the old token, if that still works.
  if (previous?.channel && previous.refreshTokenEnc) {
    const channel = previous.channel;
    accessTokenFor({ _id: `old:${previous._id}`, companyId, userId, refreshTokenEnc: previous.refreshTokenEnc })
      .then((access) => stopChannel(access, channel))
      .catch(() => {})
      .finally(() => forgetAccessToken(`old:${previous._id}`));
  }
  kickGoogleSync();
  return calendarStatus(conn);
}

/** "Join my meetings automatically" and which meetings. The calendar is read again right away under the new setting. */
export async function updateSettings(
  companyId: string,
  userId: string,
  changes: { autoJoin?: boolean; joinMode?: GoogleCalendarJoinMode },
  now = new Date()
): Promise<GoogleCalendarStatus> {
  const conn = await GoogleCalendarConnectionModel.findOneAndUpdate({ companyId, userId }, { $set: { ...changes, nextSyncAt: now } }, { new: true });
  if (!conn) throw new NotFoundError('Google Calendar connection');
  // Turning it off takes effect at once; anything else needs the calendar read again.
  if (changes.autoJoin === false) syncInBackground(await releaseAll(companyId, userId, now));
  else kickGoogleSync();
  return calendarStatus(conn);
}

function readRefreshToken(conn: Pick<GoogleCalendarConnectionDoc, 'companyId' | 'userId' | 'refreshTokenEnc'>): string | null {
  if (!conn.refreshTokenEnc) return null;
  try {
    return decryptSecret(conn.refreshTokenEnc, refreshTokenContext(conn.companyId, conn.userId));
  } catch {
    return null;
  }
}

/** Closes the push channel and revokes the grant at Google, as far as Google lets it. Never throws. */
async function letGoAtGoogle(conn: GoogleCalendarConnectionDoc & { _id: unknown }): Promise<void> {
  const refreshToken = readRefreshToken(conn);
  if (!refreshToken) return;
  const channel = conn.channel;
  if (channel) {
    // Stopping a channel needs an access token, so it goes before the revoke.
    await accessTokenFor(conn)
      .then((access) => stopChannel(access, channel))
      .catch(() => {});
  }
  await revokeToken(refreshToken).catch((error) =>
    log.warn(`[Calendar] Couldn't revoke user ${conn.userId}'s Google Calendar grant:`, errorMessage(error))
  );
}

/**
 * Disconnects the person's calendar: Google's grant is revoked, the token deleted, and meetings only
 * their calendar had are canceled. Meetings another connected member still has stay.
 */
export async function disconnect(companyId: string, userId: string, now = new Date()): Promise<void> {
  const conn = await GoogleCalendarConnectionModel.findOne({ companyId, userId }).select('+refreshTokenEnc');
  if (!conn) return;
  await letGoAtGoogle(conn);
  await GoogleCalendarConnectionModel.deleteOne({ _id: conn._id });
  forgetAccessToken(String(conn._id));
  log.info(`[Calendar] User ${userId} disconnected their Google Calendar`);
  syncInBackground(await releaseAll(companyId, userId, now));
}

/** Before a workspace is deleted: every member's grant is revoked and their connection forgotten. */
export async function forgetCalendars(companyId: string): Promise<void> {
  const connections = await GoogleCalendarConnectionModel.find({ companyId }).select('+refreshTokenEnc').limit(5000);
  for (const conn of connections) {
    await letGoAtGoogle(conn);
    forgetAccessToken(String(conn._id));
  }
  await Promise.all([GoogleCalendarConnectionModel.deleteMany({ companyId }), GoogleCalendarGrantModel.deleteMany({ companyId })]);
}
