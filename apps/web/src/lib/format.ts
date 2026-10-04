import { MEETING_PLATFORMS } from '@taro/shared';
import type { Meeting, MeetingPlatform } from '@taro/shared';

export const ACTIVE_STATUSES = new Set(['pending', 'joining', 'active']);

export type When = string | number | Date;

/**
 * The app shows times in the viewer's zone and locale. The demo is prerendered, so it passes a fixed
 * `timeZone`; that also fixes the locale to en-US, so the server and the browser print the same text.
 */
export interface Zone {
  timeZone?: string;
  locale?: string;
}

const toMs = (t: When) => (t instanceof Date ? t.getTime() : typeof t === 'number' ? t : Date.parse(t));
const localeOf = (z: Zone) => z.locale ?? (z.timeZone ? 'en-US' : undefined);

const formatters = new Map<string, Intl.DateTimeFormat>();
function formatter(z: Zone, kind: 'clock' | 'date' | 'dateYear' | 'ymd'): Intl.DateTimeFormat {
  const key = `${localeOf(z) ?? ''}|${z.timeZone ?? ''}|${kind}`;
  let f = formatters.get(key);
  if (!f) {
    const options: Intl.DateTimeFormatOptions =
      kind === 'clock'
        ? { hour: 'numeric', minute: '2-digit' }
        : kind === 'date'
          ? { month: 'short', day: 'numeric' }
          : kind === 'dateYear'
            ? { month: 'short', day: 'numeric', year: 'numeric' }
            : { year: 'numeric', month: '2-digit', day: '2-digit' };
    f = new Intl.DateTimeFormat(kind === 'ymd' ? 'en-US' : localeOf(z), { ...options, timeZone: z.timeZone });
    formatters.set(key, f);
  }
  return f;
}

/** "2:06 PM" (or "14:06", by locale). Proportional figures. */
export function formatClock(t: When, z: Zone = {}): string {
  return formatter(z, 'clock').format(toMs(t));
}

// The calendar date in the zone, as a day number and a year.
function calendarDay(ms: number, z: Zone): { day: number; year: number } {
  const parts = formatter(z, 'ymd').formatToParts(ms);
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value);
  return { day: Date.UTC(get('year'), get('month') - 1, get('day')) / 86_400_000, year: get('year') };
}

/** Calendar days between two moments in the zone: 0 is the same day, 1 is the day before. */
export function daysBefore(t: When, now: When, z: Zone = {}): number {
  return calendarDay(toMs(now), z).day - calendarDay(toMs(t), z).day;
}

/** "Sep 30", or "Sep 30, 2025" when it isn't the year of `now`. */
export function formatDate(t: When, { now = Date.now(), ...z }: Zone & { now?: When } = {}): string {
  const sameYear = calendarDay(toMs(t), z).year === calendarDay(toMs(now), z).year;
  return formatter(z, sameYear ? 'date' : 'dateYear').format(toMs(t));
}

/** "Today", "Yesterday", "Sep 30", or "Sep 30, 2025". Compares against `now` (the demo passes its capture time). */
export function formatDay(t: When, { now = Date.now(), ...z }: Zone & { now?: When } = {}): string {
  const days = daysBefore(t, now, z);
  if (days === 0) return 'Today';
  if (days === 1) return 'Yesterday';
  return formatDate(t, { ...z, now });
}

const weekdays = new Map<string, Intl.DateTimeFormat>();

/** When an upcoming meeting starts: "Today at 2:00 PM", "Tomorrow at 9:30 AM", "Thursday at 9:00 AM", "Oct 22 at 9:00 AM". */
export function formatUpcoming(t: When, { now = Date.now(), ...z }: Zone & { now?: When } = {}): string {
  const ahead = -daysBefore(t, now, z);
  const clock = formatClock(t, z);
  if (ahead <= 0) return `Today at ${clock}`;
  if (ahead === 1) return `Tomorrow at ${clock}`;
  if (ahead < 7) {
    const key = `${localeOf(z) ?? ''}|${z.timeZone ?? ''}`;
    let f = weekdays.get(key);
    if (!f) weekdays.set(key, (f = new Intl.DateTimeFormat(localeOf(z), { weekday: 'long', timeZone: z.timeZone })));
    return `${f.format(toMs(t))} at ${clock}`;
  }
  return `${formatDate(t, { ...z, now })} at ${clock}`;
}

/** "Under a minute", "26 min", "1 hr 4 min", "13 hr 19 min". */
export function formatDuration(ms: number): string {
  if (ms < 60_000) return 'Under a minute';
  const minutes = Math.round(ms / 60_000);
  if (minutes < 60) return `${minutes} min`;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return m ? `${h} hr ${m} min` : `${h} hr`;
}

/** A running clock: "34:12" or "1:04:12". */
export function formatElapsed(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const pad = (n: number) => String(n).padStart(2, '0');
  return h ? `${h}:${pad(m)}:${pad(s % 60)}` : `${m}:${pad(s % 60)}`;
}

/** "a", "a and b", "a, b, and c". */
export function listJoin(items: readonly string[]): string {
  if (items.length < 3) return items.join(' and ');
  return `${items.slice(0, -1).join(', ')}, and ${items[items.length - 1]}`;
}

export function timeAgo(iso: string | undefined, now: When = Date.now()): string {
  if (!iso) return '';
  const seconds = Math.round((toMs(now) - Date.parse(iso)) / 1000);
  if (seconds < 45) return 'just now';
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} hr ago`;
  const days = Math.round(hours / 24);
  if (days < 7) return `${days} day${days === 1 ? '' : 's'} ago`;
  return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}

export function platformLabel(platform: MeetingPlatform | undefined, url: string): string {
  if (platform) return MEETING_PLATFORMS[platform];
  if (url.includes('zoom.')) return MEETING_PLATFORMS.zoom;
  if (url.includes('teams.')) return MEETING_PLATFORMS.teams;
  return MEETING_PLATFORMS.google_meet;
}

// Meeting IDs read the way the apps print them: "842 1193 2210".
function groupDigits(id: string): string {
  const groups: Record<number, number[]> = { 9: [3, 3, 3], 10: [3, 3, 4], 11: [3, 4, 4] };
  const sizes = groups[id.length];
  if (!sizes) return id;
  let at = 0;
  return sizes.map((n) => id.slice(at, (at += n))).join(' ');
}

/** The room code people recognize: "kdp-wqmx-tvr", "842 1193 2210", or '' when a link has none worth showing. */
export function roomCode(url: string): string {
  try {
    const u = new URL(url);
    const parts = u.pathname.split('/').filter(Boolean);
    if (u.hostname === 'meet.google.com') return parts[0] ?? '';
    if (u.hostname.includes('zoom.')) {
      const id = parts[parts.length - 1] ?? '';
      return /^\d+$/.test(id) ? groupDigits(id) : id;
    }
    if (u.hostname.includes('teams.')) {
      const id = u.pathname.match(/\/meet\/(\d+)/)?.[1];
      return id ? groupDigits(id) : '';
    }
    return u.hostname;
  } catch {
    return '';
  }
}

/** @deprecated The old short form. Use `roomCode`, with `meetingTitle` for the label. */
export function shortMeetingUrl(url: string): string {
  try {
    const u = new URL(url);
    if (u.hostname === 'meet.google.com') return u.pathname.slice(1);
    if (u.hostname.includes('zoom.')) return `Zoom ${u.pathname.split('/').filter(Boolean).pop() ?? ''}`.trim();
    if (u.hostname.includes('teams.')) return 'Teams meeting';
    return u.hostname;
  } catch {
    return url;
  }
}

/** The row title: the calendar event title when there is one, else the platform; then the room code, set in Ash. */
export function meetingTitle(meeting: Pick<Meeting, 'meetUrl' | 'platform' | 'title'>): { title: string; code: string } {
  return { title: meeting.title || platformLabel(meeting.platform, meeting.meetUrl), code: roomCode(meeting.meetUrl) };
}

const SOURCE_PLACE: Record<NonNullable<Meeting['source']>, string> = {
  slack: 'Slack',
  dashboard: 'the dashboard',
  calendar: 'the calendar',
  slack_command: '/taro',
  extension: 'Google Meet',
};

const firstName = (name?: string) => name?.trim().split(/\s+/)[0] || undefined;

type WhoMeeting = Pick<Meeting, 'startedByName' | 'slackChannelName' | 'source' | 'startedAt' | 'createdAt'>;

/**
 * Who started a meeting and from where, first match wins.
 * row:    "Priya, from #product", "Sam, from the dashboard", "Started by Priya", "From Slack", "Started 9:58 AM"
 * detail: "Ana started it from #design", "Started by Priya", "Started from Slack", or ''
 * slab:   the detail form plus the time, "Priya started it from #product at 2:00 PM"
 */
export function whoAndWhere(meeting: WhoMeeting, form: 'row' | 'detail' | 'slab' = 'row', z: Zone = {}): string {
  const name = firstName(meeting.startedByName);
  const channel = meeting.slackChannelName?.replace(/^#/, '');
  const place = channel ? `#${channel}` : meeting.source ? SOURCE_PLACE[meeting.source] : undefined;
  const clock = formatClock(meeting.startedAt ?? meeting.createdAt, z);

  if (form === 'row') {
    if (name && place) return `${name}, from ${place}`;
    if (name) return `Started by ${name}`;
    if (place) return `From ${place}`;
    return `Started ${clock}`;
  }
  const who = name && place ? `${name} started it from ${place}` : name ? `Started by ${name}` : place ? `Started from ${place}` : '';
  if (form === 'detail') return who;
  return who ? `${who} at ${clock}` : `Started at ${clock}`;
}
