import type { MeetingPlatform } from '@taro/shared';

export interface MeetingLink {
  url: string;
  platform: MeetingPlatform;
}

const MEET_CODE = /^[a-z]{3}-[a-z]{4}-[a-z]{3}$/;

/** A Google Meet link built from a bare meeting code (what the browser extension sends), or null. */
export function meetLinkFromCode(code: unknown): MeetingLink | null {
  if (typeof code !== 'string') return null;
  const clean = code.trim().toLowerCase();
  return MEET_CODE.test(clean) ? { url: `https://meet.google.com/${clean}`, platform: 'google_meet' } : null;
}

/**
 * Validates and normalizes a Google Meet, Zoom, or Teams join link. Zoom and
 * Teams keep their query string because it carries the passcode/context the
 * bot needs to get in; Meet links are reduced to the canonical room URL.
 */
export function normalizeMeetingUrl(input: string): MeetingLink | null {
  let u: URL;
  try {
    u = new URL(input.trim());
  } catch {
    return null;
  }
  if (u.protocol !== 'https:' && u.protocol !== 'http:') return null;
  const host = u.hostname.toLowerCase();
  const path = u.pathname;

  if (host === 'meet.google.com') {
    const room = path.match(/^\/([a-z]{3}-[a-z]{4}-[a-z]{3})\/?$/i);
    if (!room) return null;
    return { url: `https://meet.google.com/${room[1].toLowerCase()}`, platform: 'google_meet' };
  }

  const zoomHost =
    host === 'zoom.us' || host.endsWith('.zoom.us') || host === 'zoomgov.com' || host.endsWith('.zoomgov.com');
  if (zoomHost && /^\/(j|s|w|my)\/[\w.-]+/i.test(path)) {
    u.protocol = 'https:';
    u.hash = '';
    return { url: u.toString(), platform: 'zoom' };
  }

  const teamsHost = host === 'teams.microsoft.com' || host === 'teams.live.com' || host === 'teams.cloud.microsoft';
  if (teamsHost && /^\/(l\/meetup-join\/|meet\/)/i.test(path)) {
    u.protocol = 'https:';
    u.hash = '';
    return { url: u.toString(), platform: 'teams' };
  }

  return null;
}

// Every message in every channel Taro is in passes through here, so the work
// per message is bounded no matter what someone pastes.
const MAX_SCAN_CHARS = 20_000;
const MAX_CANDIDATES = 25;
const TRAILING_PUNCTUATION = new Set([')', '.', ',', ';', ':', '!', '?']);

/** Drops prose punctuation after a link ("join here: <link>."), in linear time. */
function trimTrailingPunctuation(candidate: string): string {
  let end = candidate.length;
  while (end > 0 && TRAILING_PUNCTUATION.has(candidate[end - 1])) end--;
  return candidate.slice(0, end);
}

/**
 * Finds meeting links in a Slack message. Slack wraps links as <url> or
 * <url|label> and HTML-escapes ampersands, which would otherwise break a Zoom
 * passcode parameter.
 */
export function findMeetingLinks(text: string): MeetingLink[] {
  const unescaped = text
    .slice(0, MAX_SCAN_CHARS)
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>');
  const candidates: string[] = [];
  for (const m of unescaped.matchAll(/<(https?:\/\/[^>|\s]{1,2048})(?:\|[^>]{0,512})?>/g)) {
    candidates.push(m[1]);
    if (candidates.length >= MAX_CANDIDATES) break;
  }
  for (const m of unescaped.matchAll(/https?:\/\/[^\s<>|]{1,2048}/g)) {
    if (candidates.length >= MAX_CANDIDATES * 2) break;
    candidates.push(m[0]);
  }

  const seen = new Set<string>();
  const links: MeetingLink[] = [];
  for (const candidate of candidates) {
    const link = normalizeMeetingUrl(trimTrailingPunctuation(candidate));
    if (link && !seen.has(link.url)) {
      seen.add(link.url);
      links.push(link);
    }
  }
  return links;
}
