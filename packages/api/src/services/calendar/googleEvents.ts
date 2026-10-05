/**
 * Which events on a connected Google Calendar Taro joins, as pure functions over the events Google
 * returns, so the rules can be tested without Google or a database. Every field comes from someone
 * else's calendar, so it's treated as untrusted text: checked, capped, and kept only for the events
 * Taro will join.
 */

import type { GoogleCalendarJoinMode } from '@taro/shared';
import { sha256 } from '../../lib/crypto';
import { findMeetingLinks, normalizeMeetingUrl, type MeetingLink } from '../../lib/meetingUrl';
import { cleanText, emailFrom, linkText } from './ics';
import type { DesiredOccurrence } from './series';

const MINUTE = 60_000;
const DEFAULT_DURATION_MS = 30 * MINUTE;
const MAX_DURATION_MS = 24 * 60 * MINUTE;
const MAX_ID_CHARS = 1024;
const MAX_ENTRY_POINTS = 10;
const MAX_ATTENDEES = 50;
// A week of meetings is far fewer; a calendar with more only gets its soonest ones joined.
export const MAX_MEETINGS_PER_SYNC = 200;

/** An event Taro will join, keyed the same way on every member's calendar. */
export interface GoogleMeeting extends DesiredOccurrence {
  // "g:" and a digest of the event's iCalUID, which is the same on every calendar that has the event
  uid: string;
  organizerEmail?: string;
}

export type SkipReason = 'unreadable' | 'canceled' | 'not_a_meeting' | 'all_day' | 'declined' | 'no_guests' | 'not_organizer' | 'no_link';

export type EventResult = { meeting: GoogleMeeting } | { skip: SkipReason };

type Json = Record<string, unknown>;

const isObject = (value: unknown): value is Json => !!value && typeof value === 'object' && !Array.isArray(value);
const text = (value: unknown, max: number): string | undefined =>
  typeof value === 'string' && value.length > 0 && value.length <= max ? value : undefined;

function instant(value: unknown): Date | undefined {
  const raw = text(value, 64);
  if (!raw) return undefined;
  const date = new Date(raw);
  return Number.isFinite(date.getTime()) ? date : undefined;
}

/** When an event starts: its time, or for an all-day event the day it's on. Used to tell how far a read got. */
export function eventStart(raw: unknown): Date | undefined {
  if (!isObject(raw) || !isObject(raw.start)) return undefined;
  return instant(raw.start.dateTime) ?? instant(raw.start.date);
}

/** The meeting link: the conference Google or an add-on attached, then Meet's own link, then what people typed. */
export function linkOfEvent(event: Json): MeetingLink | undefined {
  const entryPoints = isObject(event.conferenceData) ? event.conferenceData.entryPoints : undefined;
  if (Array.isArray(entryPoints)) {
    for (const entry of entryPoints.slice(0, MAX_ENTRY_POINTS)) {
      if (!isObject(entry) || entry.entryPointType !== 'video') continue;
      const uri = text(entry.uri, 2048);
      const link = uri ? normalizeMeetingUrl(uri) : null;
      if (link) return link;
    }
  }
  const hangout = text(event.hangoutLink, 2048);
  const meet = hangout ? normalizeMeetingUrl(hangout) : null;
  if (meet) return meet;
  for (const field of ['location', 'description'] as const) {
    const value = typeof event[field] === 'string' ? (event[field] as string) : '';
    if (!value) continue;
    const [link] = findMeetingLinks(linkText(value));
    if (link) return link;
  }
  return undefined;
}

/** What one event from the calendar means for Taro: a meeting to join, or why not. */
export function readEvent(raw: unknown, mode: GoogleCalendarJoinMode): EventResult {
  if (!isObject(raw)) return { skip: 'unreadable' };
  if (raw.status === 'cancelled') return { skip: 'canceled' };
  if (raw.eventType !== undefined && raw.eventType !== 'default') return { skip: 'not_a_meeting' };

  const start = isObject(raw.start) ? raw.start : undefined;
  const end = isObject(raw.end) ? raw.end : undefined;
  // All-day events have a date and no time; nobody meets for a whole day.
  if (!start || (start.dateTime === undefined && start.date !== undefined)) return { skip: 'all_day' };
  const startsAt = instant(start.dateTime);
  if (!startsAt) return { skip: 'unreadable' };
  const ends = instant(end?.dateTime);
  const endsAt =
    ends && ends.getTime() > startsAt.getTime()
      ? new Date(Math.min(ends.getTime(), startsAt.getTime() + MAX_DURATION_MS))
      : new Date(startsAt.getTime() + DEFAULT_DURATION_MS);

  // Only the person's own entry comes back (maxAttendees=1); a declined meeting is theirs to miss.
  const attendees = Array.isArray(raw.attendees) ? raw.attendees.slice(0, MAX_ATTENDEES) : [];
  const self = attendees.find((a): a is Json => isObject(a) && a.self === true);
  if (self?.responseStatus === 'declined') return { skip: 'declined' };

  // A meeting has someone else in it. With only the person's own entry requested, Google flags other
  // guests with attendeesOmitted; someone else organizing it counts too. A block on their own
  // calendar that happens to carry a Meet link would only send a bot to an empty call.
  const organizer = isObject(raw.organizer) ? raw.organizer : undefined;
  const others =
    raw.attendeesOmitted === true || attendees.some((a) => isObject(a) && a.self !== true) || (!!organizer && organizer.self !== true);
  if (!others) return { skip: 'no_guests' };
  if (mode === 'organizer' && organizer?.self !== true) return { skip: 'not_organizer' };

  const link = linkOfEvent(raw);
  if (!link) return { skip: 'no_link' };

  const id = text(raw.iCalUID, MAX_ID_CHARS) ?? text(raw.recurringEventId, MAX_ID_CHARS) ?? text(raw.id, MAX_ID_CHARS);
  if (!id) return { skip: 'unreadable' };
  const recurring = text(raw.recurringEventId, MAX_ID_CHARS) !== undefined;
  // An occurrence of a series is named by its original start, which stays put when that one occurrence moves.
  const original = isObject(raw.originalStartTime) ? instant(raw.originalStartTime.dateTime) : undefined;
  const recurrenceKey = recurring ? (original ?? startsAt).toISOString() : '';

  return {
    meeting: {
      uid: `g:${sha256(id)}`,
      recurrenceKey,
      recurring,
      start: startsAt,
      end: endsAt,
      title: cleanText(raw.summary, 200),
      meetUrl: link.url,
      platform: link.platform,
      organizerEmail: emailFrom(organizer?.email),
    },
  };
}

/**
 * The meetings to join among a calendar's events: those starting within [from, to), once each,
 * soonest first, at most MAX_MEETINGS_PER_SYNC. When some were left out, `cutoff` is the start of
 * the first of them, so nothing from there on is read as gone from the calendar.
 */
export function meetingsFromEvents(
  items: readonly unknown[],
  mode: GoogleCalendarJoinMode,
  window: { from: Date; to: Date }
): { meetings: GoogleMeeting[]; skipped: Partial<Record<SkipReason, number>>; cutoff?: Date } {
  const skipped: Partial<Record<SkipReason, number>> = {};
  const byKey = new Map<string, GoogleMeeting>();
  for (const item of items) {
    const result = readEvent(item, mode);
    if ('skip' in result) {
      skipped[result.skip] = (skipped[result.skip] ?? 0) + 1;
      continue;
    }
    const { meeting } = result;
    const at = meeting.start.getTime();
    if (at < window.from.getTime() || at >= window.to.getTime()) continue;
    const key = `${meeting.uid}|${meeting.recurrenceKey}`;
    if (!byKey.has(key)) byKey.set(key, meeting);
  }
  const all = [...byKey.values()].sort((a, b) => a.start.getTime() - b.start.getTime());
  const meetings = all.slice(0, MAX_MEETINGS_PER_SYNC);
  const cutoff = all.length > MAX_MEETINGS_PER_SYNC ? all[MAX_MEETINGS_PER_SYNC].start : undefined;
  return { meetings, skipped, ...(cutoff ? { cutoff } : {}) };
}
