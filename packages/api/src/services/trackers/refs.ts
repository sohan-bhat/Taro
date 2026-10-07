/**
 * Ticket keys as people say them. Linear and Jira both name tickets PREFIX-NUMBER (ENG-123), and
 * speech arrives as "eng 123", "ENG123", "#123", or just "123". A bare number takes the prefix of
 * the team or project new tickets go to.
 */

import type { TrackerId, TrackerSpace } from '@taro/shared';

// The prefix is lazy, so "ENG123" splits as ENG and 123 while "ENG2-5" keeps ENG2
const KEY = /^([A-Za-z][A-Za-z0-9_]{0,9}?)?[\s\-_#]*(\d{1,7})$/;

/** "eng 123" → "ENG-123"; "123" → "<fallback>-123"; anything else → null. */
export function normalizeTicketKey(raw: string | undefined, fallbackPrefix?: string): string | null {
  const text = (raw ?? '')
    .trim()
    .replace(/^(?:ticket|issue|number|no\.?)\s*/i, '')
    .replace(/[.?!,]+$/, '');
  const m = text.match(KEY);
  if (!m) return null;
  const prefix = (m[1] ?? fallbackPrefix)?.toUpperCase();
  return prefix ? `${prefix}-${Number(m[2])}` : null;
}

export const keyPrefix = (key: string): string => key.slice(0, key.lastIndexOf('-'));

interface KnownSpaces {
  id: TrackerId;
  spaces: readonly TrackerSpace[];
}

/** The tracker whose teams or projects use this ticket's prefix, when exactly one does. */
export function trackerForKey(raw: string | undefined, trackers: readonly KnownSpaces[]): TrackerId | undefined {
  const m = (raw ?? '').trim().match(/^([A-Za-z][A-Za-z0-9_]{0,9}?)[\s\-_#]*\d{1,7}$/);
  if (!m) return undefined;
  const prefix = m[1].toUpperCase();
  const owners = trackers.filter((t) => t.spaces.some((s) => s.key.toUpperCase() === prefix));
  return owners.length === 1 ? owners[0].id : undefined;
}
