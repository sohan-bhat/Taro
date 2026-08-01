/**
 * Pure transcript-processing functions: flattening MeetingBaas word arrays,
 * normalizing speech text, and extracting "Hey Taro" commands.
 *
 * Kept side-effect free so they can be unit tested without any live services.
 */

import { WAKE_WORD_VARIATIONS } from '@taro/shared';

interface TranscriptWord {
  word?: string;
}

export interface TranscriptSegment {
  speaker?: string;
  words?: TranscriptWord[];
}

// Cap how much text after a wake word is treated as one command
const MAX_COMMAND_LENGTH = 300;
// Ignore fragments too short to be a real command ("hey taro" followed by nothing)
const MIN_COMMAND_LENGTH = 4;

/**
 * Flatten MeetingBaas `complete` webhook transcript segments into one string.
 * Words are joined with single spaces regardless of whether the provider
 * space-prefixes them (both shapes exist in the wild).
 */
export function flattenTranscript(segments: TranscriptSegment[]): string {
  return segments
    .map((segment) =>
      (segment.words ?? [])
        .map((w) => (w.word ?? '').trim())
        .filter(Boolean)
        .join(' ')
    )
    .filter(Boolean)
    .join(' ');
}

/**
 * Normalize speech text: lowercase, collapse whitespace, strip exotic symbols.
 * Basic punctuation (, . ! ?) is KEPT - commas mark list-item boundaries that
 * both Gemini and the regex fallback rely on. Wake-word matching tolerates the
 * punctuation via regex instead.
 */
export function normalizeSpeech(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s#'.,!?:;-]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

// Levenshtein edit distance (small strings, so the simple DP is plenty fast).
function levenshtein(a: string, b: string): number {
  const m = a.length;
  const n = b.length;
  if (m === 0) return n;
  if (n === 0) return m;
  let prev = Array.from({ length: n + 1 }, (_, i) => i);
  let curr = new Array<number>(n + 1);
  for (let i = 1; i <= m; i++) {
    curr[0] = i;
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      curr[j] = Math.min(prev[j] + 1, curr[j - 1] + 1, prev[j - 1] + cost);
    }
    [prev, curr] = [curr, prev];
  }
  return prev[n];
}

// 0..1 similarity: 1 = identical, lower = further apart.
function similarity(a: string, b: string): number {
  const max = Math.max(a.length, b.length);
  return max === 0 ? 1 : 1 - levenshtein(a, b) / max;
}

// "taro" anchors. sherpa-onnx renders the name many ways (taro, tarro, tero,
// terror, toro, tarot...); scoring against several anchors catches them all
// without an ever-growing hardcoded list.
const TARO_ANCHORS = ['taro', 'tero', 'tarot', 'tarrow'];
const TARO_THRESHOLD = 0.6;

// How "taro"-like a word is. Gated on starting with 't' so real words that are
// edit-close but phonetically different (hero, zero, gyro) can't trigger.
function taroScore(word: string): number {
  if (word.length < 3 || word.length > 8) return 0;
  // Every "taro" variant is t + vowel (ta/te/to...); this rejects edit-close
  // words like "there" (t-h) that would otherwise scrape the threshold.
  if (word[0] !== 't' || !'aeiou'.includes(word[1])) return 0;
  return Math.max(...TARO_ANCHORS.map((a) => similarity(word, a)));
}

// How "hey"-like the preceding word is (hey/he/hay/hi/ey...). The greeting is
// required so a stray "taro"-ish word in normal speech won't fire a command.
function isGreeting(word: string): boolean {
  if (!word) return false;
  if (word.length > 4) return false;
  return (
    levenshtein(word, 'hey') <= 1 ||
    levenshtein(word, 'hi') <= 1 ||
    ['ay', 'yo', 'ey', 'heya', 'hiya'].includes(word)
  );
}

const WORD_RE = /[\p{L}\p{N}']+/gu;

/**
 * Find wake phrases by phonetic closeness rather than a fixed list: a
 * greeting-like word ("hey"/"he"/...) immediately followed by a word close
 * enough to "taro". Returns the char span of each match (end = end of the
 * taro word), so the command is whatever follows.
 */
export function findWakeMatches(text: string): Array<{ start: number; end: number }> {
  const tokens: Array<{ word: string; start: number; end: number }> = [];
  let m: RegExpExecArray | null;
  while ((m = WORD_RE.exec(text)) !== null) {
    tokens.push({ word: m[0], start: m.index, end: m.index + m[0].length });
  }

  const matches: Array<{ start: number; end: number }> = [];
  for (let i = 1; i < tokens.length; i++) {
    if (taroScore(tokens[i].word) >= TARO_THRESHOLD && isGreeting(tokens[i - 1].word)) {
      matches.push({ start: tokens[i - 1].start, end: tokens[i].end });
    }
  }
  return matches;
}

/**
 * Find every wake phrase and return the command text that follows each one
 * (up to the next wake phrase, or MAX_COMMAND_LENGTH).
 */
export function extractCommands(
  fullText: string,
  // Kept for signature compatibility; matching is now phonetic, not list-based.
  _wakeWords: readonly string[] = WAKE_WORD_VARIATIONS
): string[] {
  const text = normalizeSpeech(fullText);
  const matches = findWakeMatches(text);

  const commands: string[] = [];
  for (let i = 0; i < matches.length; i++) {
    const sliceEnd = i + 1 < matches.length ? matches[i + 1].start : text.length;
    const command = text
      .slice(matches[i].end, sliceEnd)
      .replace(/^[\s,.!?:;-]+/, '')
      .trim()
      .slice(0, MAX_COMMAND_LENGTH)
      .trim();
    if (command.length >= MIN_COMMAND_LENGTH) {
      commands.push(command);
    }
  }

  return commands;
}
