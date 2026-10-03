// "What Taro heard": the moments around each request instead of a wall of italic text.

import { findWakeSpans, locateCommand } from '@taro/shared';

export interface ExcerptLog {
  _id?: string;
  command: string;
  createdAt?: string;
}

export interface Excerpt {
  // Offsets into the transcript, end exclusive
  start: number;
  end: number;
  text: string;
  // True when the excerpt starts after the beginning, so it renders with "…" before it
  cutBefore: boolean;
  // When the earliest request in it was made
  at?: string;
  logIds: string[];
}

const CONTEXT_BEFORE = 140;
const SENTENCE_REACH = 40;

const time = (iso?: string) => (iso ? Date.parse(iso) : Number.NaN);
const earlier = (a?: string, b?: string) => (a && b ? (time(b) < time(a) ? b : a) : a ?? b);

// From the first space at or after 140 characters before the wake phrase, so it starts on a word.
function windowStart(text: string, wakeStart: number): number {
  const from = wakeStart - CONTEXT_BEFORE;
  if (from <= 0) return 0;
  const space = text.indexOf(' ', from);
  if (space < 0 || space >= wakeStart) return wakeStart;
  let start = space + 1;
  while (start < wakeStart && /\s/.test(text[start])) start++;
  return start;
}

// To the end of the request, or the end of its sentence when that is within 40 characters.
function windowEnd(text: string, saidEnd: number): number {
  let end = saidEnd;
  if (!/[.!?]/.test(text[end - 1] ?? '')) {
    const stop = text.slice(end, end + SENTENCE_REACH).search(/[.!?]/);
    if (stop >= 0) end += stop + 1;
  }
  while (end < text.length && /["'”’)]/.test(text[end])) end++;
  return end;
}

/**
 * One excerpt per located request, oldest first. Overlapping windows merge and keep the earlier
 * time. Requests that can't be found in the text are left out.
 */
export function excerpts(text: string, logs: readonly ExcerptLog[]): Excerpt[] {
  const oldestFirst = [...logs].sort((a, b) => (time(a.createdAt) || 0) - (time(b.createdAt) || 0));
  const windows: Array<Omit<Excerpt, 'text' | 'cutBefore'>> = [];
  for (const log of oldestFirst) {
    const hit = locateCommand(text, log.command);
    if (!hit) continue;
    windows.push({
      start: windowStart(text, hit.wake.start),
      end: windowEnd(text, hit.said.end),
      at: log.createdAt,
      logIds: log._id ? [log._id] : [],
    });
  }
  windows.sort((a, b) => a.start - b.start);

  const merged: typeof windows = [];
  for (const w of windows) {
    const last = merged[merged.length - 1];
    if (last && w.start <= last.end) {
      last.end = Math.max(last.end, w.end);
      last.at = earlier(last.at, w.at);
      last.logIds.push(...w.logIds);
    } else {
      merged.push({ ...w, logIds: [...w.logIds] });
    }
  }
  return merged.map((w) => ({ ...w, text: text.slice(w.start, w.end), cutBefore: w.start > 0 }));
}

/** The first `n` characters, cut at a word, with a trailing ellipsis when cut. */
export function cutHead(text: string, n: number): { text: string; cut: boolean } {
  if (text.length <= n) return { text, cut: false };
  const s = text.slice(0, n);
  const space = s.lastIndexOf(' ');
  return { text: `${(space > 0 ? s.slice(0, space) : s).trimEnd()}…`, cut: true };
}

/** Splits said text so every wake phrase can carry the heard mark. */
export function heardParts(text: string): Array<{ text: string; heard: boolean }> {
  const parts: Array<{ text: string; heard: boolean }> = [];
  let at = 0;
  for (const span of findWakeSpans(text)) {
    if (span.start > at) parts.push({ text: text.slice(at, span.start), heard: false });
    parts.push({ text: text.slice(span.start, span.end), heard: true });
    at = span.end;
  }
  if (at < text.length) parts.push({ text: text.slice(at), heard: false });
  return parts;
}

/** True when some wake phrase in the text isn't literally "hey taro", like "Hey Tara" or "hey tero". */
export function hasMisheardWake(text: string): boolean {
  return findWakeSpans(text).some(
    (span) =>
      text
        .slice(span.start, span.end)
        .toLowerCase()
        .replace(/[^\p{L}\p{N}\s]/gu, '')
        .replace(/\s+/g, ' ')
        .trim() !== 'hey taro'
  );
}
