/**
 * Reads calendar invitations (iCalendar, RFC 5545) with ical.js: which meeting, when, who organized
 * it, and its Meet, Zoom, or Teams link. Every invitation comes from a stranger's mail, so sizes,
 * counts, and recurrence work are capped, and a time zone only ever comes from the calendar being
 * read or from the IANA database, never from someone else's mail.
 */

import ICAL from 'ical.js';
import { sha256 } from '../../lib/crypto';
import { findMeetingLinks, type MeetingLink } from '../../lib/meetingUrl';

export type CalendarMethod = 'request' | 'cancel';

export interface Organizer {
  email: string;
  name?: string;
}

export interface ParsedEvent {
  uid: string;
  // Set when this component changes one occurrence of a recurring series
  recurrenceId?: Date;
  sequence: number;
  stamp?: Date;
  canceled: boolean;
  // Unset for all-day events and for times whose zone can't be placed
  start?: Date;
  end?: Date;
  title?: string;
  organizer?: Organizer;
  link?: MeetingLink;
  // A recurring series' timing alone (its zones, DTSTART, DTEND, RRULE, RDATE, EXDATE), expanded later
  schedule?: string;
}

export interface ParsedCalendar {
  method: CalendarMethod;
  events: ParsedEvent[];
}

export interface ScheduledTime {
  // The occurrence's original start, which RECURRENCE-ID names when one instance changes
  recurrenceId: Date;
  start: Date;
  end: Date;
}

const MAX_CALENDAR_CHARS = 512 * 1024;
const MAX_EVENTS = 200;
const MAX_ZONES = 20;
const MAX_OBSERVANCES = 50;
const MAX_RULES = 2;
const MAX_DATES = 500;
const MAX_SCHEDULE_CHARS = 64 * 1024;
const MAX_UID_CHARS = 256;
const DEFAULT_DURATION_MS = 30 * 60_000;
const MAX_DURATION_MS = 24 * 60 * 60_000;
// Meetings repeat by the day, week, month, or year. Anything finer is noise or an attack.
const FREQUENCIES = new Set(['DAILY', 'WEEKLY', 'MONTHLY', 'YEARLY']);
// Expanding a series walks it from its first occurrence, so a long-running one costs a few thousand steps.
const MAX_STEPS = 20_000;
const EXPANSION_BUDGET_MS = 250;
export const MAX_OCCURRENCES_PER_WINDOW = 40;
const PRODID = '-//Taro//Calendar invitations//EN';

// ---------------------------------------------------------------------------------------------
// Time zones

const ianaZones = new Map<string, Intl.DateTimeFormat | null>();

function zoneFormatter(tzid: string): Intl.DateTimeFormat | null {
  if (ianaZones.has(tzid)) return ianaZones.get(tzid) ?? null;
  let formatter: Intl.DateTimeFormat | null = null;
  try {
    formatter = new Intl.DateTimeFormat('en-US', {
      timeZone: tzid,
      hourCycle: 'h23',
      year: 'numeric',
      month: 'numeric',
      day: 'numeric',
      hour: 'numeric',
      minute: 'numeric',
      second: 'numeric',
    });
  } catch {
    formatter = null;
  }
  // Names come from strangers' mail, so the cache can't grow without end.
  if (ianaZones.size > 500) ianaZones.clear();
  ianaZones.set(tzid, formatter);
  return formatter;
}

function zoneOffsetMs(instant: number, formatter: Intl.DateTimeFormat): number {
  const parts: Record<string, number> = {};
  for (const part of formatter.formatToParts(instant)) parts[part.type] = Number(part.value);
  const asUtc = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour % 24, parts.minute, parts.second);
  return asUtc - Math.floor(instant / 1000) * 1000;
}

/** A wall clock time in an IANA zone as an instant, or null when the zone isn't one. */
export function wallClockToUtc(wall: number, tzid: string): number | null {
  const formatter = zoneFormatter(tzid);
  if (!formatter) return null;
  const guess = wall - zoneOffsetMs(wall, formatter);
  return wall - zoneOffsetMs(guess, formatter);
}

// A zone only counts if its rules are ordinary: a few observances, each repeating yearly.
function plainZone(vtimezone: ICAL.Component): boolean {
  const observances = vtimezone.getAllSubcomponents();
  if (observances.length === 0 || observances.length > MAX_OBSERVANCES) return false;
  for (const observance of observances) {
    const rules = observance.getAllProperties('rrule');
    if (rules.length > 1) return false;
    for (const rule of rules) {
      const recur = rule.getFirstValue() as ICAL.Recur | null;
      if (!recur || recur.freq !== 'YEARLY') return false;
    }
    if (observance.getAllProperties('rdate').reduce((n, p) => n + p.getValues().length, 0) > 100) return false;
  }
  return true;
}

/**
 * ical.js keeps registered zones in one registry for the whole process. A calendar's own zones are
 * registered only while that calendar is read, synchronously so nothing else runs in between, and
 * cleared right after.
 */
function withZones<T>(vcal: ICAL.Component, run: () => T): T {
  ICAL.TimezoneService.reset();
  try {
    for (const vtimezone of vcal.getAllSubcomponents('vtimezone').slice(0, MAX_ZONES)) {
      try {
        if (!plainZone(vtimezone)) continue;
        const zone = new ICAL.Timezone(vtimezone);
        if (zone.tzid && !ICAL.TimezoneService.has(zone.tzid)) ICAL.TimezoneService.register(zone);
      } catch {
        // A zone that doesn't parse is left out; times in it fall back to the IANA name, if it is one.
      }
    }
    return run();
  } finally {
    ICAL.TimezoneService.reset();
  }
}

function tzidOf(prop: ICAL.Property | null | undefined): string | undefined {
  const tzid = prop?.getParameter('tzid');
  return typeof tzid === 'string' && tzid.length <= 200 ? tzid : undefined;
}

/** The instant an iCalendar time means. Undefined for dates and for times with no zone to place them in. */
function instantOf(time: unknown, tzid?: string): Date | undefined {
  if (!(time instanceof ICAL.Time) || time.isDate) return undefined;
  const wall = Date.UTC(time.year, time.month - 1, time.day, time.hour, time.minute, time.second);
  if (!Number.isFinite(wall)) return undefined;
  if (time.zone === ICAL.Timezone.utcTimezone) return new Date(wall);
  if (time.zone && time.zone !== ICAL.Timezone.localTimezone) {
    const ms = time.toUnixTime() * 1000;
    return Number.isFinite(ms) ? new Date(ms) : undefined;
  }
  // A zone named but not described (allowed by RFC 7809): the IANA database knows it.
  const ms = tzid ? wallClockToUtc(wall, tzid) : null;
  return ms === null ? undefined : new Date(ms);
}

function propInstant(component: ICAL.Component, name: string, fallbackTzid?: string): Date | undefined {
  const prop = component.getFirstProperty(name);
  if (!prop) return undefined;
  return instantOf(prop.getFirstValue(), tzidOf(prop) ?? fallbackTzid);
}

function endOf(vevent: ICAL.Component, start: Date): Date {
  const end = propInstant(vevent, 'dtend');
  let ms = end ? end.getTime() - start.getTime() : 0;
  if (!(ms > 0)) {
    const duration = vevent.getFirstPropertyValue('duration');
    ms = duration instanceof ICAL.Duration ? duration.toSeconds() * 1000 : 0;
  }
  if (!(ms > 0)) ms = DEFAULT_DURATION_MS;
  return new Date(start.getTime() + Math.min(ms, MAX_DURATION_MS));
}

// ---------------------------------------------------------------------------------------------
// Fields

function methodOf(value: unknown): CalendarMethod | null {
  const method = typeof value === 'string' ? value.trim().toUpperCase() : '';
  if (method === 'CANCEL') return 'cancel';
  // REQUEST is an invitation; PUBLISH, or no method at all, is an event file someone sent on purpose.
  if (method === 'REQUEST' || method === 'PUBLISH' || method === '') return 'request';
  // REPLY, COUNTER, REFRESH, ADD, DECLINECOUNTER: nothing for Taro to do.
  return null;
}

function cleanText(value: unknown, max: number): string | undefined {
  if (typeof value !== 'string') return undefined;
  const text = value.replace(/[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u2028-\u202e\u2066-\u2069]+/g, ' ').replace(/\s+/g, ' ').trim();
  return text ? text.slice(0, max).trim() : undefined;
}

function uidOf(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const uid = value.trim();
  if (!uid || /[\u0000-\u001f\u007f]/.test(uid)) return undefined;
  // Long UIDs are kept as a digest: the UID only has to match itself.
  return uid.length > MAX_UID_CHARS ? `sha256:${sha256(uid)}` : uid;
}

/** "mailto:Priya@Acme.com" or "priya@acme.com" as a lowercase address, or undefined. */
export function emailFrom(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const email = value.trim().replace(/^mailto:/i, '').trim().toLowerCase();
  return email.length <= 254 && /^[^\s@<>()"',;:]{1,64}@[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(email) ? email : undefined;
}

function organizerOf(vevent: ICAL.Component): Organizer | undefined {
  const prop = vevent.getFirstProperty('organizer');
  const email = emailFrom(prop?.getFirstValue());
  if (!prop || !email) return undefined;
  const name = cleanText(prop.getParameter('cn'), 120);
  return name && name.toLowerCase() !== email ? { email, name } : { email };
}

function asciiChar(code: number): string | undefined {
  return code >= 0x20 && code < 0x7f ? String.fromCharCode(code) : undefined;
}

// Descriptions are often HTML. Quotes end the link in an href, and entities hide characters.
function linkText(value: string): string {
  return value
    .slice(0, 50_000)
    .replace(/&#(\d{1,6});/g, (match, n: string) => asciiChar(Number(n)) ?? match)
    .replace(/&#x([0-9a-f]{1,6});/gi, (match, n: string) => asciiChar(parseInt(n, 16)) ?? match)
    .replace(/["'\\]/g, ' ');
}

// Where a meeting link can sit, the most deliberate first: a location someone typed, the conference
// Google or Microsoft attached, then free text.
const LINK_FIELDS = [
  'location',
  'x-google-conference',
  'x-microsoft-skypeteamsmeetingurl',
  'x-microsoft-onlinemeetingexternallink',
  'url',
  'description',
  'summary',
];

function linkOf(vevent: ICAL.Component): MeetingLink | undefined {
  for (const name of LINK_FIELDS) {
    for (const prop of vevent.getAllProperties(name).slice(0, 5)) {
      const value = prop.getFirstValue();
      if (typeof value !== 'string' || !value) continue;
      const [link] = findMeetingLinks(linkText(value));
      if (link) return link;
    }
  }
  return undefined;
}

function sequenceOf(value: unknown): number {
  const n = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(n) ? Math.min(Math.max(Math.trunc(n), 0), 1_000_000) : 0;
}

// ---------------------------------------------------------------------------------------------
// Series

function countDates(vevent: ICAL.Component): number {
  return ['rdate', 'exdate'].reduce((n, name) => n + vevent.getAllProperties(name).reduce((m, p) => m + p.getValues().length, 0), 0);
}

/** Recurrence Taro will expand: at most two rules, each daily or coarser, and a bounded list of dates. */
function plainRecurrence(vevent: ICAL.Component): boolean {
  const rules = vevent.getAllProperties('rrule');
  if (rules.length > MAX_RULES) return false;
  for (const rule of rules) {
    const recur = rule.getFirstValue() as ICAL.Recur | null;
    if (!recur || !FREQUENCIES.has(String(recur.freq))) return false;
  }
  return countDates(vevent) <= MAX_DATES;
}

const TIMING = new Set(['dtstart', 'dtend', 'duration', 'rrule', 'rdate', 'exdate']);
type JcalProperty = [string, Record<string, unknown>, ...unknown[]];

/** The series' timing as its own small calendar: what the daily pass expands, with nothing personal in it. */
function scheduleOf(vcal: ICAL.Component, vevent: ICAL.Component): string | undefined {
  const props = (vevent.jCal[1] as JcalProperty[]).filter((p) => TIMING.has(p[0]));
  const tzids = new Set(props.map((p) => p[1]?.tzid).filter((tzid): tzid is string => typeof tzid === 'string'));
  const zones = vcal
    .getAllSubcomponents('vtimezone')
    .filter((zone) => tzids.has(String(zone.getFirstPropertyValue('tzid'))))
    .slice(0, MAX_ZONES)
    .map((zone) => zone.jCal);
  const text = ICAL.stringify([
    'vcalendar',
    [
      ['version', {}, 'text', '2.0'],
      ['prodid', {}, 'text', PRODID],
    ],
    [...zones, ['vevent', [['uid', {}, 'text', 'schedule'], ...props], []]],
  ] as unknown as unknown[]);
  return text.length <= MAX_SCHEDULE_CHARS ? text : undefined;
}

function readEvent(vcal: ICAL.Component, vevent: ICAL.Component, method: CalendarMethod): ParsedEvent | null {
  const uid = uidOf(vevent.getFirstPropertyValue('uid'));
  if (!uid) return null;

  const recurrenceProp = vevent.getFirstProperty('recurrence-id');
  const startProp = vevent.getFirstProperty('dtstart');
  // A RECURRENCE-ID without its own zone is in the series' zone.
  const recurrenceId = recurrenceProp ? instantOf(recurrenceProp.getFirstValue(), tzidOf(recurrenceProp) ?? tzidOf(startProp)) : undefined;
  if (recurrenceProp && !recurrenceId) return null;

  const status = String(vevent.getFirstPropertyValue('status') ?? '').toUpperCase();
  const canceled = method === 'cancel' || status === 'CANCELLED';
  const start = instantOf(startProp?.getFirstValue(), tzidOf(startProp));
  const event: ParsedEvent = {
    uid,
    ...(recurrenceId ? { recurrenceId } : {}),
    sequence: sequenceOf(vevent.getFirstPropertyValue('sequence')),
    stamp: propInstant(vevent, 'dtstamp'),
    canceled,
    ...(start ? { start, end: endOf(vevent, start) } : {}),
    title: cleanText(vevent.getFirstPropertyValue('summary'), 200),
    organizer: organizerOf(vevent),
    link: linkOf(vevent),
  };

  const recurring = !recurrenceProp && (vevent.hasProperty('rrule') || vevent.hasProperty('rdate'));
  if (recurring && !canceled) {
    if (!start || !plainRecurrence(vevent)) return null;
    const schedule = scheduleOf(vcal, vevent);
    if (!schedule) return null;
    event.schedule = schedule;
  }
  return event;
}

/** The invitation in one text/calendar part, or null when there's nothing in it for Taro. */
export function parseCalendar(text: string): ParsedCalendar | null {
  if (typeof text !== 'string' || !text.trim() || text.length > MAX_CALENDAR_CHARS) return null;
  let vcal: ICAL.Component;
  try {
    const jcal = ICAL.parse(text.replace(/^\uFEFF/, '')) as unknown[];
    // Several calendars in one part: the first is the invitation.
    vcal = new ICAL.Component((Array.isArray(jcal[0]) ? jcal[0] : jcal) as unknown[]);
  } catch {
    return null;
  }
  if (vcal.name !== 'vcalendar') return null;
  const method = methodOf(vcal.getFirstPropertyValue('method'));
  if (!method) return null;

  return withZones(vcal, () => {
    const events: ParsedEvent[] = [];
    for (const vevent of vcal.getAllSubcomponents('vevent').slice(0, MAX_EVENTS)) {
      try {
        const event = readEvent(vcal, vevent, method);
        if (event) events.push(event);
      } catch {
        // One malformed event doesn't sink the rest.
      }
    }
    return { method, events };
  });
}

/**
 * The occurrences of a series that start within [from, to], at most MAX_OCCURRENCES_PER_WINDOW.
 * `finished` is true once the series has no occurrences left after these (COUNT or UNTIL ran out).
 */
export function expandSchedule(schedule: string, from: Date, to: Date): { times: ScheduledTime[]; finished: boolean } {
  let vcal: ICAL.Component;
  try {
    vcal = new ICAL.Component(ICAL.parse(schedule) as unknown[]);
  } catch {
    return { times: [], finished: true };
  }
  return withZones(vcal, () => {
    const vevent = vcal.getFirstSubcomponent('vevent');
    const startProp = vevent?.getFirstProperty('dtstart');
    const tzid = tzidOf(startProp);
    const first = instantOf(startProp?.getFirstValue(), tzid);
    if (!vevent || !first) return { times: [], finished: true };
    const durationMs = endOf(vevent, first).getTime() - first.getTime();

    // ical.js skips EXDATEs itself, but only when it can compare zones; this catches the rest.
    const excluded = new Set<number>();
    for (const prop of vevent.getAllProperties('exdate')) {
      for (const value of prop.getValues()) {
        const at = instantOf(value, tzidOf(prop) ?? tzid);
        if (at) excluded.add(at.getTime());
      }
    }

    const times: ScheduledTime[] = [];
    const deadline = Date.now() + EXPANSION_BUDGET_MS;
    let steps = 0;
    let next: ICAL.Time | undefined;
    try {
      const iterator = new ICAL.Event(vevent, { strictExceptions: true }).iterator();
      while ((next = iterator.next())) {
        if (++steps > MAX_STEPS || Date.now() > deadline) return { times, finished: false };
        const at = instantOf(next, tzid);
        if (!at) continue;
        if (at.getTime() > to.getTime()) return { times, finished: false };
        if (at.getTime() < from.getTime() || excluded.has(at.getTime())) continue;
        times.push({ recurrenceId: at, start: at, end: new Date(at.getTime() + durationMs) });
        if (times.length >= MAX_OCCURRENCES_PER_WINDOW) return { times, finished: false };
      }
    } catch {
      return { times, finished: false };
    }
    return { times, finished: true };
  });
}
