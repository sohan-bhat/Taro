/**
 * The rules for calendar invitations, as pure functions over plain values so they can be tested
 * without a database: how an invitation changes what Taro knows about a meeting, which occurrences
 * that means over the next two weeks, what each stored occurrence becomes, and when Taro acts on it.
 */

import type { MeetingPlatform } from '@taro/shared';
import type { SeriesApproval, SeriesOverride } from '../../db/models/CalendarSeries';
import type { OccurrenceStatus } from '../../db/models/CalendarOccurrence';
import { expandSchedule, type CalendarMethod, type ParsedEvent } from './ics';

const MINUTE = 60_000;
const DAY = 24 * 60 * MINUTE;

// Recurring series are kept as occurrences this far ahead; a daily pass moves the window along.
export const WINDOW_MS = 14 * DAY;
// Meetings more than this far past their start are skipped, not joined late.
export const LATE_MS = 10 * MINUTE;
// What's left of a meeting is kept this long after it ends, then deleted.
export const KEEP_AFTER_END_MS = 7 * DAY;
// MeetingBaas locks a scheduled bot 4 minutes before it joins; Taro confirms it a minute before that.
export const CONFIRM_LEAD_MS = 5 * MINUTE;
// With no scheduled bot, Taro sends one this long before the start.
export const IMMEDIATE_LEAD_MS = MINUTE;
// A scheduled bot needs time to be confirmed before its lock, and MeetingBaas takes up to 90 days ahead.
export const SCHEDULE_MIN_LEAD_MS = 6 * MINUTE;
export const SCHEDULE_MAX_AHEAD_MS = 89 * DAY;
// Scheduled bots are told to join at the start.
export const JOIN_LEAD_MS = 0;
const MAX_OVERRIDES = 200;

/** The fields of a stored series that the rules read and write. */
export interface SeriesState {
  sequence: number;
  stamp?: Date;
  hasMaster: boolean;
  title?: string;
  organizerEmail?: string;
  organizerName?: string;
  meetUrl?: string;
  platform?: MeetingPlatform;
  start?: Date;
  end?: Date;
  schedule?: string;
  overrides: SeriesOverride[];
  canceledAt?: Date;
  approval: SeriesApproval;
  sponsorName?: string;
  sponsorUserId?: string;
  // Who the mail that last changed it came from, for whoever decides whether to approve it
  senderEmail?: string;
}

/** A member who vouches for an invitation. */
export interface Sponsor {
  name: string;
  userId?: string;
}

/** One invitation's components for one UID. */
export interface SeriesMessage {
  method: CalendarMethod;
  events: ParsedEvent[];
  // The member the mail came from, or null when nobody in the workspace vouches for it
  sponsor: Sponsor | null;
  // The mail's From address
  from?: string;
}

export interface ApplyResult {
  state: SeriesState;
  changed: boolean;
  // An approved meeting was moved or relinked by mail nobody vouched for, so it waits for approval again
  reapprove: boolean;
}

const time = (d?: Date) => (d ? d.getTime() : undefined);
const sameTime = (a?: Date, b?: Date) => time(a) === time(b);

// SEQUENCE first, then DTSTAMP: a copy that is older than what Taro holds changes nothing.
function isStale(incoming: { sequence: number; stamp?: Date }, held: { sequence: number; stamp?: Date }): boolean {
  if (incoming.sequence !== held.sequence) return incoming.sequence < held.sequence;
  return !!incoming.stamp && !!held.stamp && incoming.stamp.getTime() < held.stamp.getTime();
}

function newest(events: ParsedEvent[]): ParsedEvent | undefined {
  return events.reduce<ParsedEvent | undefined>((best, e) => (!best || isStale(best, e) ? e : best), undefined);
}

const timingOf = (s: Pick<SeriesState, 'start' | 'end' | 'schedule'>) => `${time(s.start)}|${time(s.end)}|${s.schedule ?? ''}`;

function overrideFrom(event: ParsedEvent, canceled: boolean): SeriesOverride {
  return {
    recurrenceId: event.recurrenceId!,
    sequence: event.sequence,
    stamp: event.stamp,
    canceled,
    start: event.start,
    end: event.end,
    title: event.title,
    meetUrl: event.link?.url,
    platform: event.link?.platform,
  };
}

function sameOverride(a: SeriesOverride, b: SeriesOverride): boolean {
  return (
    a.canceled === b.canceled &&
    a.sequence === b.sequence &&
    sameTime(a.stamp, b.stamp) &&
    sameTime(a.start, b.start) &&
    sameTime(a.end, b.end) &&
    a.title === b.title &&
    a.meetUrl === b.meetUrl
  );
}

/**
 * What one invitation (REQUEST or CANCEL, for one UID) does to the series Taro holds. Returns null
 * when there's nothing to store: a cancellation for a meeting Taro never had.
 */
export function applyMessage(current: SeriesState | null, message: SeriesMessage, now: Date): ApplyResult | null {
  const cancel = message.method === 'cancel';
  if (!current && cancel) return null;

  const state: SeriesState = current
    ? { ...current, overrides: [...current.overrides] }
    : {
        sequence: 0,
        hasMaster: false,
        overrides: [],
        approval: message.sponsor ? 'approved' : 'pending',
        ...(message.sponsor ? { sponsorName: message.sponsor.name, sponsorUserId: message.sponsor.userId } : {}),
      };
  let changed = !current;
  // Moves and relinks of anything that still happens, which mail nobody vouched for can't make on its own
  let moved = false;

  const master = newest(message.events.filter((e) => !e.recurrenceId));
  if (master && (!state.hasMaster || !isStale(master, state))) {
    if (cancel || master.canceled) {
      if (!state.canceledAt) {
        state.canceledAt = now;
        changed = true;
      }
      if (master.sequence > state.sequence) state.sequence = master.sequence;
    } else {
      const before = { timing: timingOf(state), link: state.meetUrl, canceled: !!state.canceledAt, hadMaster: state.hasMaster };
      const next: Partial<SeriesState> = {
        hasMaster: true,
        sequence: master.sequence,
        stamp: master.stamp,
        title: master.title,
        organizerEmail: master.organizer?.email,
        organizerName: master.organizer?.name,
        meetUrl: master.link?.url,
        platform: master.link?.platform,
        start: master.start,
        end: master.end,
        schedule: master.schedule,
        canceledAt: undefined,
      };
      const timingChanged = timingOf(next as SeriesState) !== before.timing;
      // Google and Outlook both drop changed occurrences when a whole series moves, so Taro does too.
      if (before.hadMaster && timingChanged && master.sequence > state.sequence) {
        const kept = new Set(message.events.filter((e) => e.recurrenceId).map((e) => e.recurrenceId!.getTime()));
        state.overrides = state.overrides.filter((o) => kept.has(o.recurrenceId.getTime()));
      }
      const fieldsChanged = (Object.keys(next) as Array<keyof SeriesState>).some((key) => {
        const a = state[key];
        const b = next[key];
        return a instanceof Date || b instanceof Date ? !sameTime(a as Date | undefined, b as Date | undefined) : a !== b;
      });
      Object.assign(state, next);
      if (fieldsChanged) changed = true;
      moved ||= before.hadMaster && (timingChanged || before.link !== state.meetUrl || before.canceled);
    }
  }

  for (const event of message.events) {
    if (!event.recurrenceId) continue;
    const at = event.recurrenceId.getTime();
    const index = state.overrides.findIndex((o) => o.recurrenceId.getTime() === at);
    const held = index >= 0 ? state.overrides[index] : undefined;
    if (held && isStale(event, held)) continue;
    const next = overrideFrom(event, cancel || event.canceled);
    if (held && sameOverride(held, next)) continue;
    if (index >= 0) state.overrides[index] = next;
    else state.overrides.push(next);
    changed = true;
    if (!next.canceled && current) {
      // Compared with what this occurrence was: its last change, or the series as scheduled.
      const was = held && !held.canceled ? held : { start: next.recurrenceId, meetUrl: state.meetUrl };
      moved ||= (!!next.start && !sameTime(was.start, next.start)) || (!!next.meetUrl && next.meetUrl !== (was.meetUrl ?? state.meetUrl));
    }
    // One occurrence can arrive before (or without) its series: it names the meeting until then.
    if (!state.hasMaster) {
      state.title ??= event.title;
      state.organizerEmail ??= event.organizer?.email;
      state.organizerName ??= event.organizer?.name;
    }
  }

  // Old changes stop mattering once their occurrences are long past.
  const cutoff = now.getTime() - KEEP_AFTER_END_MS;
  state.overrides = state.overrides
    .filter((o) => o.recurrenceId.getTime() >= cutoff || (o.start && o.start.getTime() >= cutoff))
    .sort((a, b) => a.recurrenceId.getTime() - b.recurrenceId.getTime())
    .slice(-MAX_OVERRIDES);

  if (changed && message.from) state.senderEmail = message.from;

  let reapprove = false;
  if (message.sponsor) {
    if (state.approval !== 'approved') {
      state.approval = 'approved';
      state.sponsorName = message.sponsor.name;
      state.sponsorUserId = message.sponsor.userId;
      changed = true;
    }
  } else if (current && state.approval === 'approved' && moved && !cancel) {
    state.approval = 'pending';
    reapprove = true;
    changed = true;
  }
  return { state, changed, reapprove };
}

/** One occurrence the series says should exist. */
export interface DesiredOccurrence {
  recurrenceKey: string;
  recurring: boolean;
  start: Date;
  end: Date;
  title?: string;
  meetUrl: string;
  platform: MeetingPlatform;
}

/**
 * The occurrences that start within [from, to]: a one-off event's single occurrence wherever it falls
 * after `from`, and a series' occurrences within the window, with changed occurrences applied and
 * canceled ones gone. Occurrences without a meeting link are left out; Taro has nowhere to go.
 */
export function desiredOccurrences(state: SeriesState, from: Date, to: Date): { desired: DesiredOccurrence[]; finished: boolean } {
  if (state.canceledAt) return { desired: [], finished: true };
  const byKey = new Map<string, Partial<DesiredOccurrence> & { start: Date; end: Date; recurrenceKey: string }>();
  let finished = true;

  if (state.hasMaster && state.schedule) {
    const expansion = expandSchedule(state.schedule, from, to);
    finished = expansion.finished;
    for (const t of expansion.times) {
      const key = t.recurrenceId.toISOString();
      byKey.set(key, { recurrenceKey: key, recurring: true, start: t.start, end: t.end });
    }
  } else if (state.hasMaster && state.start && state.end) {
    byKey.set('', { recurrenceKey: '', recurring: false, start: state.start, end: state.end });
  }

  const linkOverride = new Map<string, { title?: string; meetUrl?: string; platform?: MeetingPlatform }>();
  for (const o of state.overrides) {
    const key = o.recurrenceId.toISOString();
    if (o.canceled) {
      byKey.delete(key);
      continue;
    }
    const generated = byKey.get(key);
    const start = o.start ?? generated?.start;
    const end = o.end ?? generated?.end;
    if (!start || !end || start.getTime() < from.getTime() || start.getTime() > to.getTime()) {
      byKey.delete(key);
      continue;
    }
    byKey.set(key, { recurrenceKey: key, recurring: true, start, end });
    linkOverride.set(key, { title: o.title, meetUrl: o.meetUrl, platform: o.platform });
  }

  const desired: DesiredOccurrence[] = [];
  for (const entry of byKey.values()) {
    if (entry.start.getTime() < from.getTime()) continue;
    const own = linkOverride.get(entry.recurrenceKey);
    const meetUrl = own?.meetUrl ?? state.meetUrl;
    const platform = own?.meetUrl ? own.platform : state.platform;
    if (!meetUrl || !platform) continue;
    desired.push({
      recurrenceKey: entry.recurrenceKey,
      recurring: entry.recurring ?? true,
      start: entry.start,
      end: entry.end,
      title: own?.title ?? state.title,
      meetUrl,
      platform,
    });
  }
  desired.sort((a, b) => a.start.getTime() - b.start.getTime());
  return { desired, finished };
}

/** A stored occurrence, as far as reconciling goes. */
export interface StoredOccurrence {
  recurrenceKey: string;
  status: OccurrenceStatus;
  start: Date;
  skipReason?: 'person' | 'late';
}

export type OccurrenceChange =
  | { kind: 'upsert'; desired: DesiredOccurrence; status: OccurrenceStatus; relaunch: boolean }
  | { kind: 'cancel'; recurrenceKey: string };

const statusForApproval = (approval: SeriesApproval): OccurrenceStatus =>
  approval === 'approved' ? 'scheduled' : approval === 'pending' ? 'needs_approval' : 'canceled';

/**
 * How the stored occurrences change to match the series. A person's Skip stands, and an occurrence
 * Taro already joined stays joined, unless the meeting moved to a later time, which makes it a new
 * occurrence as far as joining goes. Anything no longer wanted that hasn't happened is canceled.
 */
export function planOccurrences(
  stored: StoredOccurrence[],
  desired: DesiredOccurrence[],
  approval: SeriesApproval,
  now: Date
): OccurrenceChange[] {
  const wanted = statusForApproval(approval);
  const byKey = new Map(stored.map((s) => [s.recurrenceKey, s]));
  const changes: OccurrenceChange[] = [];

  for (const d of desired) {
    const row = byKey.get(d.recurrenceKey);
    const movedLater = !!row && Math.abs(row.start.getTime() - d.start.getTime()) >= MINUTE && d.start.getTime() > now.getTime();
    let status = wanted;
    let relaunch = false;
    if (row?.status === 'launched') {
      if (movedLater) relaunch = true;
      else status = 'launched';
    } else if (row?.status === 'skipped' && wanted !== 'canceled') {
      if (row.skipReason === 'late' && movedLater) relaunch = true;
      else status = 'skipped';
    }
    changes.push({ kind: 'upsert', desired: d, status, relaunch });
  }

  const keys = new Set(desired.map((d) => d.recurrenceKey));
  for (const row of stored) {
    if (keys.has(row.recurrenceKey)) continue;
    if (row.status === 'scheduled' || row.status === 'needs_approval' || (row.status === 'skipped' && row.skipReason === 'person')) {
      changes.push({ kind: 'cancel', recurrenceKey: row.recurrenceKey });
    }
  }
  return changes;
}

// ---------------------------------------------------------------------------------------------
// Bots and launches

export interface BotRef {
  joinAt: Date;
  meetUrl: string;
}

/** When a scheduled bot for an occurrence should join. */
export const joinAtFor = (start: Date) => new Date(start.getTime() - JOIN_LEAD_MS);

/** The scheduled bot still fits the occurrence: same time, same link. */
export function botFits(bot: BotRef | undefined, start: Date, meetUrl: string): bot is BotRef {
  return !!bot && Math.abs(bot.joinAt.getTime() - joinAtFor(start).getTime()) < MINUTE && bot.meetUrl === meetUrl;
}

/** When the scheduler takes an occurrence: to confirm its scheduled bot, or to send one right away. */
export function launchAtFor(start: Date, meetUrl: string, bot?: BotRef): Date {
  return new Date(start.getTime() - (botFits(bot, start, meetUrl) ? CONFIRM_LEAD_MS : IMMEDIATE_LEAD_MS));
}

export type BotPlan =
  | { kind: 'none' }
  // Too far ahead for MeetingBaas; look again then
  | { kind: 'later'; at: Date }
  | { kind: 'create'; joinAt: Date }
  | { kind: 'move'; joinAt: Date; meetUrl: string }
  | { kind: 'release' };

/**
 * What MeetingBaas needs so it matches the occurrence. Only a scheduled occurrence in a ready
 * workspace gets a bot. Too close to the start to schedule or move one, the scheduler sends a bot
 * right away instead.
 */
export function planBot(
  occurrence: { status: OccurrenceStatus; start: Date; meetUrl: string; bot?: BotRef },
  ready: boolean,
  now: Date
): BotPlan {
  const { status, start, meetUrl, bot } = occurrence;
  const lead = start.getTime() - now.getTime();
  if (status !== 'scheduled' || !ready) return bot ? { kind: 'release' } : { kind: 'none' };
  if (botFits(bot, start, meetUrl)) return { kind: 'none' };
  if (lead < SCHEDULE_MIN_LEAD_MS) return bot ? { kind: 'release' } : { kind: 'none' };
  if (lead > SCHEDULE_MAX_AHEAD_MS) {
    return bot ? { kind: 'release' } : { kind: 'later', at: new Date(start.getTime() - SCHEDULE_MAX_AHEAD_MS + MINUTE) };
  }
  return bot ? { kind: 'move', joinAt: joinAtFor(start), meetUrl } : { kind: 'create', joinAt: joinAtFor(start) };
}

export type LaunchPlan = { kind: 'confirm' } | { kind: 'immediate' } | { kind: 'wait'; until: Date };

/**
 * What the scheduler does with an occurrence it just took. A scheduled bot that still fits is
 * confirmed, unless MeetingBaas says it failed or was canceled. Without one, a bot goes in right
 * away, but no earlier than a minute before the start.
 */
export function planLaunch(
  occurrence: { start: Date; meetUrl: string; bot?: BotRef },
  scheduled: 'ok' | 'gone' | 'unknown',
  now: Date
): LaunchPlan {
  if (botFits(occurrence.bot, occurrence.start, occurrence.meetUrl) && scheduled !== 'gone') return { kind: 'confirm' };
  const sendAt = occurrence.start.getTime() - IMMEDIATE_LEAD_MS;
  return now.getTime() < sendAt ? { kind: 'wait', until: new Date(sendAt) } : { kind: 'immediate' };
}

/** Filter for occurrences the scheduler takes now; matching it and setting `launched` is one atomic update. */
export function dueFilter(now: Date) {
  return { status: 'scheduled', launchAt: { $lte: now }, start: { $gte: new Date(now.getTime() - LATE_MS) } };
}

/** Filter for scheduled occurrences too late to join. */
export function lateFilter(now: Date) {
  return { status: 'scheduled', start: { $lt: new Date(now.getTime() - LATE_MS) } };
}
