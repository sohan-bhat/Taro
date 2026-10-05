/**
 * Calendar invitations in the database. Mail that arrived for a workspace's Taro address becomes a
 * series and its occurrences; the dashboard's Skip, Approve, and Decline act on them, and on the
 * occurrences members' connected Google Calendars make. Every query is scoped to one workspace, so one
 * workspace's mail never touches another's meetings.
 */

import { Error as MongooseError, type HydratedDocument } from 'mongoose';
import { COPY, type UpcomingMeeting } from '@taro/shared';
import { CalendarOccurrenceModel, CalendarSeriesModel, CompanyModel } from '../../db/models';
import type { CalendarSeriesDoc } from '../../db/models/CalendarSeries';
import type { CalendarOccurrenceDoc, OccurrenceStatus } from '../../db/models/CalendarOccurrence';
import { ConflictError, NotFoundError } from '../../lib/errors';
import { newInviteToken, tokenFromAddress } from '../../lib/inviteAddress';
import { windowCounter } from '../../lib/rateLimit';
import { log, errorMessage } from '../../lib/logger';
import { MeetingBaasClient, MeetingBaasError } from '../meetingbaas';
import { missingSetup } from '../meetingLauncher';
import { resolveProviders } from '../workspaceProviders';
import { botContext, DIRTY, syncInBackground } from './bots';
import { parseCalendar, type CalendarMethod, type ParsedCalendar, type ParsedEvent } from './ics';
import type { InboundMail } from './mail';
import { writeOccurrence } from './occurrences';
import {
  applyMessage,
  CONFIRM_LEAD_MS,
  desiredOccurrences,
  KEEP_AFTER_END_MS,
  LATE_MS,
  launchAtFor,
  planOccurrences,
  WINDOW_MS,
  type SeriesMessage,
  type SeriesState,
} from './series';
import { findSponsor, memberLookup } from './trust';

const DAY = 24 * 60 * 60_000;
// Invitation mail each workspace takes per hour, per API instance; more than that is dropped.
const inboundPerWorkspace = windowCounter({ windowMs: 60 * 60_000, max: 120 });
// Invitations nobody vouched for wait for approval; a workspace holds at most this many at once.
const MAX_PENDING = 30;
// A declined meeting is remembered this long after its last word, so its updates don't ask again.
const DECLINED_KEEP_MS = 30 * DAY;

// ---------------------------------------------------------------------------------------------
// The workspace's address

/** The workspace's invite token, made the first time anyone asks. */
export async function inviteTokenFor(companyId: string): Promise<string> {
  const company = await CompanyModel.findById(companyId).select('inviteToken');
  if (!company) throw new NotFoundError('Workspace');
  if (company.inviteToken) return company.inviteToken;
  // Two first requests at once: only one token is kept.
  await CompanyModel.updateOne({ _id: companyId, inviteToken: { $exists: false } }, { $set: { inviteToken: newInviteToken() } });
  const saved = await CompanyModel.findById(companyId).select('inviteToken');
  if (!saved?.inviteToken) throw new NotFoundError('Workspace');
  return saved.inviteToken;
}

/** A new address; the old one stops working at once. Meetings already scheduled stay scheduled. */
export async function rotateInviteToken(companyId: string): Promise<string> {
  const token = newInviteToken();
  const result = await CompanyModel.updateOne({ _id: companyId }, { $set: { inviteToken: token } });
  if (result.matchedCount === 0) throw new NotFoundError('Workspace');
  log.info(`[Calendar] Workspace ${companyId} has a new invite address`);
  return token;
}

// ---------------------------------------------------------------------------------------------
// Series

function stateOf(doc: HydratedDocument<CalendarSeriesDoc>): SeriesState {
  const o = doc.toObject();
  return {
    sequence: o.sequence ?? 0,
    stamp: o.stamp,
    hasMaster: !!o.hasMaster,
    title: o.title,
    organizerEmail: o.organizerEmail,
    organizerName: o.organizerName,
    meetUrl: o.meetUrl,
    platform: o.platform,
    start: o.start,
    end: o.end,
    schedule: o.schedule,
    overrides: o.overrides ?? [],
    canceledAt: o.canceledAt,
    approval: o.approval,
    sponsorName: o.sponsorName,
    sponsorUserId: o.sponsorUserId,
    senderEmail: o.senderEmail,
  };
}

// Every field of the state, so one left undefined is cleared rather than kept.
function fieldsOf(state: SeriesState): Partial<CalendarSeriesDoc> {
  return {
    sequence: state.sequence,
    stamp: state.stamp,
    hasMaster: state.hasMaster,
    title: state.title,
    organizerEmail: state.organizerEmail,
    organizerName: state.organizerName,
    meetUrl: state.meetUrl,
    platform: state.platform,
    start: state.start,
    end: state.end,
    schedule: state.schedule,
    overrides: state.overrides,
    canceledAt: state.canceledAt,
    approval: state.approval,
    sponsorName: state.sponsorName,
    sponsorUserId: state.sponsorUserId,
    senderEmail: state.senderEmail,
  };
}

const isWriteConflict = (error: unknown) =>
  error instanceof MongooseError.VersionError || (error as { code?: unknown } | null)?.code === 11000;

/** Applies one invitation to the stored series, starting over if another copy saved first. Returns the series' ID. */
async function storeMessage(companyId: string, uid: string, message: SeriesMessage, now: Date): Promise<string | null> {
  for (let attempt = 0; attempt < 3; attempt++) {
    const doc = await CalendarSeriesModel.findOne({ companyId, uid });
    if (!doc && !message.sponsor && message.method === 'request') {
      const pending = await CalendarSeriesModel.countDocuments({ companyId, approval: 'pending', canceledAt: { $exists: false } });
      if (pending >= MAX_PENDING) {
        log.warn(`[Calendar] Workspace ${companyId} already has ${pending} invitations waiting for approval; dropped another`);
        return null;
      }
    }
    const result = applyMessage(doc ? stateOf(doc) : null, message, now);
    if (!result) return null;
    if (result.reapprove) log.info(`[Calendar] An approved meeting changed by mail nobody vouched for; it waits for approval again`);
    if (!result.changed) return doc ? String(doc._id) : null;
    try {
      if (doc) {
        doc.set(fieldsOf(result.state));
        await doc.save();
        return String(doc._id);
      }
      const created = await CalendarSeriesModel.create({ companyId, uid, ...fieldsOf(result.state) });
      return String(created._id);
    } catch (error) {
      if (!isWriteConflict(error)) throw error;
    }
  }
  log.warn(`[Calendar] Gave up saving an invitation for workspace ${companyId} after repeated conflicts`);
  return null;
}

/**
 * Makes the stored occurrences match the series over the next two weeks, and moves the series'
 * window and lifetime along. Returns the occurrences whose MeetingBaas bot may need syncing.
 */
export async function reconcileSeries(seriesId: string, now = new Date()): Promise<string[]> {
  const series = await CalendarSeriesModel.findById(seriesId);
  if (!series) return [];
  const state = stateOf(series);
  const companyId = series.companyId;
  const uid = series.uid;
  const from = new Date(now.getTime() - LATE_MS);
  const to = new Date(now.getTime() + WINDOW_MS);
  const { desired, finished } = desiredOccurrences(state, from, to);

  const keys = desired.map((d) => d.recurrenceKey);
  const stored = await CalendarOccurrenceModel.find({
    companyId,
    seriesId,
    $or: [{ start: { $gte: from } }, { recurrenceKey: { $in: keys } }],
  });
  const byKey = new Map(stored.map((row) => [row.recurrenceKey, row]));
  const changes = planOccurrences(
    stored.map((row) => ({ recurrenceKey: row.recurrenceKey, status: row.status, start: row.start, skipReason: row.skipReason })),
    desired,
    state.approval,
    now
  );

  const touched: string[] = [];
  for (const change of changes) {
    if (change.kind === 'cancel') {
      const row = byKey.get(change.recurrenceKey)!;
      await CalendarOccurrenceModel.updateOne(
        { _id: row._id, status: { $in: ['scheduled', 'needs_approval', 'skipped'] } },
        { ...DIRTY, $set: { ...DIRTY.$set, status: 'canceled' } }
      );
      touched.push(String(row._id));
      continue;
    }

    const id = await writeOccurrence({
      companyId,
      uid,
      row: byKey.get(change.desired.recurrenceKey),
      desired: change.desired,
      status: change.status,
      relaunch: change.relaunch,
      values: { seriesId, organizerEmail: state.organizerEmail, organizerName: state.organizerName, senderEmail: state.senderEmail },
    });
    if (id) touched.push(id);
  }

  // A series still running keeps its two week window; anything that's over goes away a week after it ends.
  const ends = [now.getTime(), ...desired.map((d) => d.end.getTime()), ...(state.end ? [state.end.getTime()] : [])];
  for (const o of state.overrides) if (o.end) ends.push(o.end.getTime());
  const update =
    state.approval === 'declined'
      ? { $set: { expiresAt: new Date(now.getTime() + DECLINED_KEEP_MS) }, $unset: { expandedUntil: 1 } }
      : finished || !state.schedule
        ? { $set: { expiresAt: new Date(Math.max(...ends) + KEEP_AFTER_END_MS) }, $unset: { expandedUntil: 1 } }
        : { $set: { expandedUntil: to }, $unset: { expiresAt: 1 } };
  await CalendarSeriesModel.updateOne({ _id: series._id }, update);
  return touched;
}

// ---------------------------------------------------------------------------------------------
// Mail

interface Group {
  uid: string;
  method: CalendarMethod;
  events: ParsedEvent[];
}

// One message can hold several meetings; each UID is its own series.
function groupByUid(calendars: ParsedCalendar[]): Group[] {
  const groups = new Map<string, Group>();
  for (const calendar of calendars) {
    for (const event of calendar.events) {
      const key = `${calendar.method}\u0000${event.uid}`;
      const group = groups.get(key) ?? { uid: event.uid, method: calendar.method, events: [] };
      group.events.push(event);
      groups.set(key, group);
    }
  }
  return [...groups.values()].slice(0, 20);
}

export type ReceiveResult = { ignored: string } | { workspaces: number; meetings: number };

/**
 * Mail for one or more Taro addresses. Each workspace whose token appears among the recipients gets
 * its own copy of the invitation, judged by its own members. Returns quickly; MeetingBaas bots are
 * scheduled afterwards in the background.
 */
export async function receiveMail(mail: InboundMail, now = new Date()): Promise<ReceiveResult> {
  const calendars = mail.calendars.map(parseCalendar).filter((c): c is ParsedCalendar => !!c && c.events.length > 0);
  if (calendars.length === 0) return { ignored: 'no_invitation' };
  const tokens = [...new Set(mail.recipients.map(tokenFromAddress).filter((t): t is string => !!t))].slice(0, 5);
  if (tokens.length === 0) return { ignored: 'no_taro_address' };
  const companies = await CompanyModel.find({ inviteToken: { $in: tokens } }).select('_id signInWith directoryId personal');
  if (companies.length === 0) return { ignored: 'unknown_address' };

  const groups = groupByUid(calendars);
  let meetings = 0;
  const touched: string[] = [];
  for (const company of companies) {
    const companyId = String(company._id);
    if (!inboundPerWorkspace.hit(companyId).allowed) {
      log.warn(`[Calendar] Workspace ${companyId} is over its hourly invitation limit; dropped one`);
      continue;
    }
    const isMember = memberLookup(company);
    for (const group of groups) {
      const organizer = group.events.find((e) => e.organizer)?.organizer;
      const sponsor = await findSponsor({ from: mail.from, organizerEmail: organizer?.email, organizerName: organizer?.name }, isMember);
      const seriesId = await storeMessage(companyId, group.uid, { method: group.method, events: group.events, sponsor, from: mail.from }, now);
      if (!seriesId) continue;
      meetings++;
      touched.push(...(await reconcileSeries(seriesId, now)));
      log.info(`[Calendar] ${group.method === 'cancel' ? 'Cancellation' : 'Invitation'} for workspace ${companyId}${sponsor ? '' : ' (needs approval)'}`);
    }
  }
  syncInBackground(touched);
  return { workspaces: companies.length, meetings };
}

// ---------------------------------------------------------------------------------------------
// The dashboard

function publicUpcoming(o: CalendarOccurrenceDoc & { _id: unknown }, missing: string[]): UpcomingMeeting {
  const problem = o.status === 'scheduled' ? (missing.length ? COPY.notReady(missing) : o.botError) : undefined;
  return {
    _id: String(o._id),
    title: o.title,
    startsAt: o.start.toISOString(),
    endsAt: o.end.toISOString(),
    meetUrl: o.meetUrl,
    platform: o.platform,
    source: o.source === 'google' ? 'google' : 'invite',
    status: o.status as UpcomingMeeting['status'],
    recurring: !!o.recurring,
    organizerName: o.organizerName,
    organizerEmail: o.organizerEmail,
    ...(o.status === 'needs_approval' && o.senderEmail ? { sentBy: o.senderEmail } : {}),
    ...(problem ? { problem } : {}),
  };
}

/**
 * The next two weeks of meetings Taro will join, soonest first, as `userId` sees them: everything
 * invited to the workspace's address, and the meetings from their own Google Calendar.
 */
export async function upcomingFor(companyId: string, userId: string, now = new Date()): Promise<UpcomingMeeting[]> {
  const company = await CompanyModel.findById(companyId);
  if (!company) throw new NotFoundError('Workspace');
  const missing = missingSetup(resolveProviders(company));
  const rows = await CalendarOccurrenceModel.find({
    companyId,
    start: { $gte: new Date(now.getTime() - LATE_MS), $lte: new Date(now.getTime() + WINDOW_MS) },
    $and: [
      { $or: [{ status: { $in: ['scheduled', 'needs_approval'] } }, { status: 'skipped', skipReason: 'person' }] },
      // A connected calendar's meetings are its owner's: only the members whose calendars have one see it here.
      { $or: [{ source: { $ne: 'google' } }, { holders: userId }] },
    ],
  })
    .sort({ start: 1 })
    .limit(50);
  return rows.map((row) => publicUpcoming(row, missing));
}

async function findOccurrence(companyId: string, id: string, userId: string) {
  const occurrence = await CalendarOccurrenceModel.findOne({ _id: id, companyId });
  // Members who can't see a meeting from someone's Google Calendar can't act on it either.
  if (!occurrence || (occurrence.source === 'google' && !occurrence.holders?.includes(userId))) throw new NotFoundError('Meeting');
  return occurrence;
}

const NOT_UPCOMING: Partial<Record<OccurrenceStatus, string>> = {
  launched: 'Taro is already on its way to that meeting.',
  canceled: 'That meeting was canceled.',
  skipped: 'Taro is already skipping that meeting.',
};
const TOO_LATE_TO_SKIP = "Taro is already on its way to that meeting, so it can't be skipped now. Make Taro leave once it joins.";

/** Skips one occurrence. Its scheduled bot is canceled right away, so a refusal reaches the person who asked. */
export async function skipOccurrence(companyId: string, id: string, userId: string, now = new Date()): Promise<void> {
  const occurrence = await findOccurrence(companyId, id, userId);
  if (occurrence.status !== 'scheduled' && occurrence.status !== 'needs_approval') {
    throw new ConflictError(NOT_UPCOMING[occurrence.status] ?? 'That meeting has already started.');
  }
  // MeetingBaas locks a scheduled bot 4 minutes before it joins, and Taro confirms it at 5.
  if (occurrence.bot && occurrence.start.getTime() - now.getTime() < CONFIRM_LEAD_MS + 30_000) throw new ConflictError(TOO_LATE_TO_SKIP);

  const skipped = await CalendarOccurrenceModel.findOneAndUpdate(
    { _id: occurrence._id, status: { $in: ['scheduled', 'needs_approval'] } },
    { ...DIRTY, $set: { ...DIRTY.$set, status: 'skipped', skipReason: 'person', skippedByUserId: userId } },
    { new: true }
  );
  if (!skipped) throw new ConflictError(TOO_LATE_TO_SKIP);
  if (!occurrence.bot) return;

  const ctx = await botContext(companyId);
  if (!ctx?.key) return;
  try {
    await new MeetingBaasClient(ctx.key).cancelScheduledBot(occurrence.bot.id);
  } catch (error) {
    if (error instanceof MeetingBaasError && error.status === 409) {
      // MeetingBaas won't call it off, so Taro still goes; the occurrence goes back to what it was.
      await CalendarOccurrenceModel.updateOne(
        { _id: occurrence._id, status: 'skipped', skippedByUserId: userId },
        { $set: { status: occurrence.status }, $unset: { skipReason: 1, skippedByUserId: 1 } }
      );
      throw new ConflictError(TOO_LATE_TO_SKIP);
    }
    if (!(error instanceof MeetingBaasError && error.status === 404)) {
      // Left marked for the scheduler, which tries the cancel again.
      log.warn(`[Calendar] Couldn't cancel the scheduled bot for a skipped meeting yet: ${errorMessage(error)}`);
      return;
    }
  }
  await CalendarOccurrenceModel.updateOne({ _id: occurrence._id, botRev: skipped.botRev }, { $set: { botDirty: false }, $unset: { bot: 1 } });
}

/** What an occurrence would be without a Skip: what its series says, or for a Google Calendar meeting, whether anyone still has it. */
async function unskippedStatus(occurrence: CalendarOccurrenceDoc): Promise<OccurrenceStatus> {
  if (occurrence.source === 'google') return occurrence.holders?.length ? 'scheduled' : 'canceled';
  const series = await CalendarSeriesModel.findOne({ _id: occurrence.seriesId, companyId: occurrence.companyId });
  return !series || series.canceledAt || series.approval === 'declined' ? 'canceled' : series.approval === 'approved' ? 'scheduled' : 'needs_approval';
}

/** Undoes a person's Skip, while there's still time to join. */
export async function restoreOccurrence(companyId: string, id: string, userId: string, now = new Date()): Promise<void> {
  const occurrence = await findOccurrence(companyId, id, userId);
  if (occurrence.status !== 'skipped' || occurrence.skipReason !== 'person') throw new ConflictError("That meeting isn't skipped.");
  if (occurrence.start.getTime() < now.getTime() - LATE_MS) throw new ConflictError('That meeting started too long ago to join.');
  const status = await unskippedStatus(occurrence);
  await CalendarOccurrenceModel.updateOne(
    { _id: occurrence._id, status: 'skipped' },
    { ...DIRTY, $set: { ...DIRTY.$set, status, launchAt: launchAtFor(occurrence.start, occurrence.meetUrl) }, $unset: { skipReason: 1, skippedByUserId: 1 } }
  );
  syncInBackground([String(occurrence._id)]);
}

/** Approves or declines the meeting an occurrence belongs to: every occurrence of a series at once. */
export async function decideOccurrence(
  companyId: string,
  id: string,
  decision: 'approve' | 'decline',
  by: { userId: string; name?: string },
  now = new Date()
): Promise<void> {
  const occurrence = await findOccurrence(companyId, id, by.userId);
  if (occurrence.source === 'google') throw new ConflictError("That meeting is on a member's own calendar, so it doesn't need approval.");
  const series = await CalendarSeriesModel.findOne({ _id: occurrence.seriesId, companyId });
  if (!series || series.canceledAt) throw new ConflictError('That meeting was canceled.');
  if (series.approval !== 'pending') {
    throw new ConflictError(series.approval === 'approved' ? 'That meeting is already approved.' : 'That meeting was already declined.');
  }
  series.approval = decision === 'approve' ? 'approved' : 'declined';
  series.decidedByUserId = by.userId;
  if (decision === 'approve') {
    series.sponsorName = by.name;
    series.sponsorUserId = by.userId;
  }
  try {
    await series.save();
  } catch (error) {
    if (isWriteConflict(error)) throw new ConflictError('That meeting just changed. Try again.');
    throw error;
  }
  syncInBackground(await reconcileSeries(String(series._id), now));
}

/** Before a workspace is deleted: its scheduled bots are canceled and its invitations forgotten. */
export async function forgetWorkspace(companyId: string): Promise<void> {
  const ctx = await botContext(companyId).catch(() => null);
  const held = await CalendarOccurrenceModel.find({ companyId, 'bot.id': { $type: 'string' }, status: { $ne: 'launched' } }).select('bot');
  if (ctx?.key) {
    const client = new MeetingBaasClient(ctx.key);
    for (const o of held) await client.cancelScheduledBot(o.bot!.id).catch(() => {});
  }
  await Promise.all([CalendarOccurrenceModel.deleteMany({ companyId }), CalendarSeriesModel.deleteMany({ companyId })]);
}
