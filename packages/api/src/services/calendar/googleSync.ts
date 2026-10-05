/**
 * Connected Google Calendars, on Taro's side. Each member's primary calendar is read every couple of
 * minutes, and within seconds when Google says it changed, and the meetings Taro should join become
 * occurrences: the same ones invitations make, so MeetingBaas bots, Skip, the late rule, and launching
 * work exactly as they do for invitations. A person's own calendar vouches for its meetings, so
 * nothing waits for approval.
 *
 * The same meeting on two members' calendars is one occurrence, keyed by its iCalUID and original
 * start, and both of them hold it. A member whose calendar no longer has it (deleted, declined, moved
 * out of the week, its link gone, or no longer matching their setting) lets go of it, and it's
 * canceled once nobody connected holds it.
 */

import { randomUUID } from 'crypto';
import type { HydratedDocument } from 'mongoose';
import { mongoose } from '../../db/mongo';
import { CalendarOccurrenceModel, GoogleCalendarConnectionModel, UserModel } from '../../db/models';
import type { GoogleCalendarConnectionDoc } from '../../db/models/GoogleCalendarConnection';
import { env } from '../../config/env';
import { decryptSecret, randomToken, safeEqual, sha256 } from '../../lib/crypto';
import { log, errorMessage } from '../../lib/logger';
import { DIRTY, syncInBackground } from './bots';
import { GoogleApiError, GoogleGrantRevoked, hasCalendarScope, listEvents, refreshAccessToken, stopChannel, watchEvents } from './googleApi';
import { eventStart, meetingsFromEvents, type GoogleMeeting } from './googleEvents';
import { writeOccurrence } from './occurrences';
import { LATE_MS, planOccurrences } from './series';

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
// Each connected calendar is read this often...
export const POLL_MS = 2 * MINUTE;
// ...or this often once Google's notifications arrive, when polling only catches the ones Google drops.
export const SAFETY_POLL_MS = 10 * MINUTE;
// With automatic joining off nothing is read; the pass only makes sure nothing is held.
const IDLE_MS = HOUR;
// Taro joins meetings that start within the next week, or started less than 10 minutes ago.
export const LOOKAHEAD_MS = 7 * DAY;
const LEASE_MS = 2 * MINUTE;
const RETRY_MS = [MINUTE, 5 * MINUTE, 15 * MINUTE, HOUR];
const MAX_PAGES = 4;
const MAX_SYNCS_PER_PASS = 200;
const PARALLEL = 8;
// A notification this soon after a read waits for the gap, so a burst of edits is one read.
const MIN_GAP_MS = 10_000;
const CHANNEL_TTL_S = 7 * 24 * 60 * 60;
const RENEW_BEFORE_MS = DAY;
const CHANNEL_RETRY_MS = 6 * HOUR;
const MAX_HELD = 1000;

type Connection = HydratedDocument<GoogleCalendarConnectionDoc>;
type Window = { from: Date; to: Date };

/** The refresh token is encrypted for one member of one workspace; copied onto any other record it won't decrypt. */
export const refreshTokenContext = (companyId: string, userId: string) => `google-calendar:${companyId}:${userId}`;

// ---------------------------------------------------------------------------------------------
// Access tokens: in memory only, never in the database

const accessTokens = new Map<string, { token: string; expiresAt: number; enc: string }>();

type TokenSource = Pick<GoogleCalendarConnectionDoc, 'companyId' | 'userId' | 'refreshTokenEnc'> & { _id: unknown };

export async function accessTokenFor(conn: TokenSource): Promise<string> {
  const id = String(conn._id);
  const enc = conn.refreshTokenEnc;
  if (!enc) throw new GoogleGrantRevoked('invalid_grant');
  const cached = accessTokens.get(id);
  if (cached && cached.enc === enc && cached.expiresAt - Date.now() > MINUTE) return cached.token;
  let refreshToken: string;
  try {
    refreshToken = decryptSecret(enc, refreshTokenContext(conn.companyId, conn.userId));
  } catch {
    // Sealed under another key, or for someone else: as good as revoked.
    throw new GoogleGrantRevoked('invalid_grant');
  }
  const fresh = await refreshAccessToken(refreshToken);
  if (fresh.scope !== undefined && !hasCalendarScope(fresh.scope)) throw new GoogleGrantRevoked('scope');
  accessTokens.set(id, { token: fresh.accessToken, expiresAt: Date.now() + fresh.expiresInS * 1000, enc });
  return fresh.accessToken;
}

export function forgetAccessToken(connectionId: string): void {
  accessTokens.delete(connectionId);
}

// ---------------------------------------------------------------------------------------------
// Holding and letting go

const keyOf = (uid: string, recurrenceKey: string) => `${uid}|${recurrenceKey}`;

/**
 * The member lets go of one occurrence. When nobody connected holds it any more it's canceled, as an
 * invitation that went away would be, unless Taro already went. Returns its ID when its bot needs a look.
 */
export async function releaseHold(companyId: string, occurrenceId: string, userId: string): Promise<string | null> {
  const row = await CalendarOccurrenceModel.findOneAndUpdate(
    { _id: occurrenceId, companyId, holders: userId },
    { $pull: { holders: userId } },
    { new: true }
  ).select('holders');
  if (!row || (row.holders?.length ?? 0) > 0) return null;
  // Checked again as it's canceled: another member's read may have taken it up meanwhile.
  const result = await CalendarOccurrenceModel.updateOne(
    { _id: occurrenceId, companyId, holders: { $size: 0 }, status: { $in: ['scheduled', 'needs_approval', 'skipped'] } },
    { ...DIRTY, $set: { ...DIRTY.$set, status: 'canceled' } }
  );
  return result.modifiedCount ? occurrenceId : null;
}

/** The member holds nothing any more: disconnected, removed, Google refused access, or automatic joining is off. */
export async function releaseAll(companyId: string, userId: string, now: Date): Promise<string[]> {
  const touched: string[] = [];
  const upcoming = await CalendarOccurrenceModel.find({
    companyId,
    source: 'google',
    holders: userId,
    start: { $gte: new Date(now.getTime() - LATE_MS) },
  })
    .select('_id')
    .limit(MAX_HELD);
  for (const row of upcoming) {
    const id = await releaseHold(companyId, String(row._id), userId);
    if (id) touched.push(id);
  }
  // Meetings that already happened only keep their record a week; they let go of the person too.
  await CalendarOccurrenceModel.updateMany({ companyId, source: 'google', holders: userId }, { $pull: { holders: userId } });
  return touched;
}

/**
 * Makes the member's holds match the meetings just read from their calendar: each one held, with its
 * time, title, and link as the calendar has them now, and everything else they held within `window`
 * let go. Statuses follow the same rules as invitations: a Skip stands, and a meeting Taro already
 * joined stays joined unless it moved later. Returns the occurrences whose bots need a look.
 */
export async function applyMeetings(companyId: string, userId: string, meetings: GoogleMeeting[], window: Window, now: Date): Promise<string[]> {
  const touched: string[] = [];
  const uids = [...new Set(meetings.map((m) => m.uid))];
  const stored = uids.length ? await CalendarOccurrenceModel.find({ companyId, source: 'google', uid: { $in: uids } }) : [];
  const byKey = new Map(stored.map((row) => [keyOf(row.uid, row.recurrenceKey), row]));

  for (const meeting of meetings) {
    const row = byKey.get(keyOf(meeting.uid, meeting.recurrenceKey));
    const known = row ? [{ recurrenceKey: row.recurrenceKey, status: row.status, start: row.start, skipReason: row.skipReason }] : [];
    const [change] = planOccurrences(known, [meeting], 'approved', now);
    if (!change || change.kind !== 'upsert') continue;
    const id = await writeOccurrence({
      companyId,
      uid: meeting.uid,
      row,
      desired: meeting,
      status: change.status,
      relaunch: change.relaunch,
      values: { source: 'google', organizerEmail: meeting.organizerEmail },
      holder: userId,
    });
    if (id) touched.push(id);
  }

  if (window.to.getTime() <= window.from.getTime()) return touched;
  const wanted = new Set(meetings.map((m) => keyOf(m.uid, m.recurrenceKey)));
  const held = await CalendarOccurrenceModel.find({
    companyId,
    source: 'google',
    holders: userId,
    start: { $gte: window.from, $lt: window.to },
  })
    .select('_id uid recurrenceKey')
    .limit(MAX_HELD);
  for (const row of held) {
    if (wanted.has(keyOf(row.uid, row.recurrenceKey))) continue;
    const id = await releaseHold(companyId, String(row._id), userId);
    if (id) touched.push(id);
  }
  return touched;
}

// ---------------------------------------------------------------------------------------------
// Reading a calendar

interface CalendarRead {
  items: unknown[];
  // False when there were more pages than Taro reads
  complete: boolean;
}

async function readCalendar(token: string, window: Window): Promise<CalendarRead> {
  const items: unknown[] = [];
  let pageToken: string | undefined;
  for (let page = 0; page < MAX_PAGES; page++) {
    const result = await listEvents(token, window, pageToken);
    items.push(...result.items);
    pageToken = result.nextPageToken;
    if (!pageToken) return { items, complete: true };
  }
  return { items, complete: false };
}

/** Reads with the cached access token, and once more with a fresh one if Google turns the cached one away. */
async function readWithFreshToken(conn: Connection, window: Window): Promise<{ read: CalendarRead; token: string }> {
  const first = await accessTokenFor(conn);
  try {
    return { read: await readCalendar(first, window), token: first };
  } catch (error) {
    if (error instanceof GoogleApiError && error.status === 403 && error.reason === 'insufficientPermissions') throw new GoogleGrantRevoked('scope');
    if (!(error instanceof GoogleApiError && error.status === 401)) throw error;
  }
  forgetAccessToken(String(conn._id));
  const token = await accessTokenFor(conn);
  return { read: await readCalendar(token, window), token };
}

/**
 * Reads one connected calendar and brings the member's holds up to date. Returns the occurrences
 * whose bots need a look, and whether Google was read at all.
 */
export async function syncConnection(conn: Connection, now: Date): Promise<{ touched: string[]; read: boolean }> {
  const { companyId, userId } = conn;
  const member = await UserModel.findOne({ _id: userId, companyId }).select('removedAt');
  // Someone an owner removed brings Taro nowhere, and with joining off there's nothing to read for.
  if (!member || member.removedAt || !conn.autoJoin) return { touched: await releaseAll(companyId, userId, now), read: false };

  const window = { from: new Date(now.getTime() - LATE_MS), to: new Date(now.getTime() + LOOKAHEAD_MS) };
  const { read, token } = await readWithFreshToken(conn, window);
  const { meetings, cutoff } = meetingsFromEvents(read.items, conn.joinMode, window);
  // Pages Taro didn't read, or meetings past the cap, may still be on the calendar: only what came before them is judged.
  let until = window.to;
  if (!read.complete) until = eventStart(read.items[read.items.length - 1]) ?? window.from;
  if (cutoff && cutoff.getTime() < until.getTime()) until = cutoff;
  const touched = await applyMeetings(companyId, userId, meetings, { from: window.from, to: until }, now);

  // The person may have disconnected, or turned joining off, while the read was underway.
  const current = await GoogleCalendarConnectionModel.findById(conn._id).select('status autoJoin');
  if (!current || current.status !== 'active' || !current.autoJoin) touched.push(...(await releaseAll(companyId, userId, now)));
  else await keepChannel(conn, token, now);
  return { touched, read: true };
}

// ---------------------------------------------------------------------------------------------
// Push notifications

/** Google only delivers to https with a valid certificate, so a local API polls. */
export const pushAvailable = () => env.apiUrl.startsWith('https://');
const notifyAddress = () => `${env.apiUrl}/api/google-calendar/notify`;

/** Keeps a push channel open, so Google says when the calendar changes. Polling carries on either way. */
async function keepChannel(conn: Connection, token: string, now: Date): Promise<void> {
  if (!pushAvailable()) return;
  const old = conn.channel;
  if (old && old.expiresAt.getTime() - now.getTime() > RENEW_BEFORE_MS) return;
  if (conn.channelRetryAt && conn.channelRetryAt.getTime() > now.getTime()) return;

  const id = randomUUID();
  const secret = randomToken(32);
  let opened: Awaited<ReturnType<typeof watchEvents>>;
  try {
    opened = await watchEvents(token, { id, token: secret, address: notifyAddress(), ttlSeconds: CHANNEL_TTL_S });
  } catch (error) {
    log.warn(`[Calendar] Google wouldn't open a push channel for user ${conn.userId}'s calendar, so Taro polls it: ${errorMessage(error)}`);
    await GoogleCalendarConnectionModel.updateOne({ _id: conn._id }, { $set: { channelRetryAt: new Date(now.getTime() + CHANNEL_RETRY_MS) } });
    return;
  }
  const saved = await GoogleCalendarConnectionModel.updateOne(
    { _id: conn._id, status: 'active' },
    {
      $set: { channel: { id, tokenHash: sha256(secret), resourceId: opened.resourceId, expiresAt: opened.expiresAt } },
      $unset: { channelRetryAt: 1 },
    }
  );
  // The channel it replaces closes; if the person disconnected meanwhile, so does the new one.
  const closing = saved.matchedCount ? old : { id, resourceId: opened.resourceId };
  if (closing) await stopChannel(token, closing).catch(() => {});
}

export interface ChannelNotice {
  channelId: string;
  token: string;
  resourceId: string;
  // sync (the channel opened), exists (something changed), or not_exists
  state: string;
}

/**
 * Google says a connected calendar changed. The notice carries no event data; once its channel's
 * token checks out, that calendar is simply read again within seconds. False for a notice Taro
 * can't place.
 */
export async function channelNotified(notice: ChannelNotice, now = new Date()): Promise<boolean> {
  const conn = await GoogleCalendarConnectionModel.findOne({ 'channel.id': notice.channelId, status: 'active' }).select('+channel.tokenHash');
  const channel = conn?.channel;
  if (!conn || !channel?.tokenHash || channel.resourceId !== notice.resourceId || !safeEqual(sha256(notice.token), channel.tokenHash)) {
    return false;
  }
  // Notices arriving means polling can slow to a safety net.
  if (!channel.confirmedAt) {
    await GoogleCalendarConnectionModel.updateOne({ _id: conn._id, 'channel.id': channel.id }, { $set: { 'channel.confirmedAt': now } });
  }
  if (notice.state === 'sync') return true;
  const at = new Date(Math.max(now.getTime(), (conn.syncStartedAt?.getTime() ?? 0) + MIN_GAP_MS));
  await GoogleCalendarConnectionModel.updateOne({ _id: conn._id, nextSyncAt: { $gt: at } }, { $set: { nextSyncAt: at } });
  kickGoogleSync(at.getTime() - now.getTime());
  return true;
}

// ---------------------------------------------------------------------------------------------
// The pass

let warnedApiOff = false;

function noteFailure(conn: Connection, error: unknown) {
  if (error instanceof GoogleApiError && error.reason === 'accessNotConfigured') {
    if (!warnedApiOff) {
      warnedApiOff = true;
      log.error(
        "[Calendar] The Google Calendar API is turned off in this Google Cloud project, so connected calendars can't be read. Enable it (docs/DEPLOY.md)."
      );
    }
    return;
  }
  log.warn(`[Calendar] Couldn't read user ${conn.userId}'s Google Calendar: ${errorMessage(error)}`);
}

/** Google refused the grant: the connection waits for the person to reconnect, and Taro lets go of their meetings. */
async function needsReconnect(conn: Connection, why: GoogleGrantRevoked['why'], now: Date): Promise<string[]> {
  await GoogleCalendarConnectionModel.updateOne(
    { _id: conn._id },
    { $set: { status: 'reconnect' }, $unset: { refreshTokenEnc: 1, channel: 1, channelRetryAt: 1, syncLeaseUntil: 1, syncFailures: 1 } }
  );
  forgetAccessToken(String(conn._id));
  log.info(`[Calendar] User ${conn.userId}'s Google Calendar needs reconnecting (${why}); Taro let go of its meetings`);
  return releaseAll(conn.companyId, conn.userId, now);
}

/** Takes the next calendar due for a read, with one atomic update, so two API instances never read one at once. */
function leaseNext(now: Date) {
  return GoogleCalendarConnectionModel.findOneAndUpdate(
    { status: 'active', nextSyncAt: { $lte: now }, $or: [{ syncLeaseUntil: { $exists: false } }, { syncLeaseUntil: { $lte: now } }] },
    { $set: { syncLeaseUntil: new Date(now.getTime() + LEASE_MS), syncStartedAt: now, nextSyncAt: new Date(now.getTime() + POLL_MS) } },
    { sort: { nextSyncAt: 1 }, new: true }
  ).select('+refreshTokenEnc');
}

/** Syncs one leased calendar and records how it went. Returns the occurrences whose bots need a look. */
export async function runSync(conn: Connection, now: Date): Promise<string[]> {
  const lease = { _id: conn._id, syncLeaseUntil: conn.syncLeaseUntil };
  try {
    const { touched, read } = await syncConnection(conn, now);
    await GoogleCalendarConnectionModel.updateOne(lease, {
      ...(read ? { $set: { lastSyncedAt: now } } : {}),
      $unset: { syncLeaseUntil: 1, syncFailures: 1 },
    });
    const live = !!conn.channel?.confirmedAt && conn.channel.expiresAt.getTime() > now.getTime() + SAFETY_POLL_MS;
    const gap = !read ? IDLE_MS : live ? SAFETY_POLL_MS : POLL_MS;
    // Unless a notification or a new setting asked for a sooner read meanwhile
    if (gap !== POLL_MS) {
      await GoogleCalendarConnectionModel.updateOne(
        { _id: conn._id, nextSyncAt: new Date(now.getTime() + POLL_MS) },
        { $set: { nextSyncAt: new Date(now.getTime() + gap) } }
      );
    }
    return touched;
  } catch (error) {
    if (error instanceof GoogleGrantRevoked) return needsReconnect(conn, error.why, now);
    noteFailure(conn, error);
    const failures = (conn.syncFailures ?? 0) + 1;
    await GoogleCalendarConnectionModel.updateOne(lease, {
      $set: { syncFailures: failures, nextSyncAt: new Date(now.getTime() + RETRY_MS[Math.min(failures, RETRY_MS.length) - 1]) },
      $unset: { syncLeaseUntil: 1 },
    });
    return [];
  }
}

let passing = false;

/** One pass over the calendars due for a read, a few side by side. Overlapping passes are skipped. Returns how many it took. */
export async function googleCalendarTick(now = new Date()): Promise<number> {
  if (passing) return 0;
  passing = true;
  let taken = 0;
  try {
    while (taken < MAX_SYNCS_PER_PASS) {
      const batch: Connection[] = [];
      while (batch.length < PARALLEL && taken + batch.length < MAX_SYNCS_PER_PASS) {
        const conn = await leaseNext(now);
        if (!conn) break;
        batch.push(conn);
      }
      if (batch.length === 0) break;
      taken += batch.length;
      const touched = await Promise.all(
        batch.map((conn) =>
          runSync(conn, now).catch((error) => {
            log.warn(`[Calendar] Google Calendar sync failed for user ${conn.userId}:`, errorMessage(error));
            return [] as string[];
          })
        )
      );
      syncInBackground(touched.flat());
    }
  } finally {
    passing = false;
  }
  return taken;
}

let kickTimer: ReturnType<typeof setTimeout> | null = null;

/** A pass soon, for a calendar that just connected, changed its setting, or changed on Google's side. */
export function kickGoogleSync(delayMs = 0): void {
  if (kickTimer || mongoose.connection.readyState !== 1) return;
  kickTimer = setTimeout(() => {
    kickTimer = null;
    googleCalendarTick().catch((error) => log.warn('[Calendar] Google Calendar sync failed:', errorMessage(error)));
  }, Math.min(Math.max(delayMs, 0), MIN_GAP_MS));
  kickTimer.unref?.();
}
