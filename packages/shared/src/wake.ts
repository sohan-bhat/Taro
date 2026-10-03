// Finding "Hey Taro" in speech. The API pulls commands out of transcripts with
// normalizeSpeech and findWakeMatches; the dashboard and demo use the display
// helpers below to mark wake phrases and show where each request was said.

/**
 * Normalize speech text: lowercase, collapse whitespace, strip exotic symbols.
 * Basic punctuation (, . ! ?) is kept because commas mark list-item boundaries
 * that the model and the regex fallback rely on. Wake-word matching tolerates
 * the punctuation via regex instead.
 */
export function normalizeSpeech(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s#'.,!?:;-]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

// Small strings, so the simple O(mn) DP is plenty fast.
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

function similarity(a: string, b: string): number {
  const max = Math.max(a.length, b.length);
  return max === 0 ? 1 : 1 - levenshtein(a, b) / max;
}

// sherpa-onnx renders "taro" many ways (tarro, tero, terror, toro, tarot...),
// so scoring against several anchors catches them all without a hardcoded list.
const TARO_ANCHORS = ['taro', 'tero', 'tarot', 'tarrow'];
const TARO_THRESHOLD = 0.6;

function taroScore(word: string): number {
  if (word.length < 3 || word.length > 8) return 0;
  // Every "taro" variant is t + vowel, which rejects edit-close but phonetically
  // different words like "there" or "hero" that would otherwise scrape the threshold.
  if (word[0] !== 't' || !'aeiou'.includes(word[1])) return 0;
  return Math.max(...TARO_ANCHORS.map((a) => similarity(word, a)));
}

// Requiring a greeting (hey/he/hay/hi/ey...) before the taro-like word keeps a
// stray "taro"-ish word in normal speech from firing a command.
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
 * Finds wake phrases by phonetic closeness rather than a fixed list. Returns
 * the char span of each match, ending at the taro word, so the command is whatever follows.
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

/** A range of characters in a string, end exclusive. */
export interface TextSpan {
  start: number;
  end: number;
}

/** Lowercases A to Z only, so every character keeps its index. */
export const lowerAscii = (s: string) => s.replace(/[A-Z]/g, (c) => c.toLowerCase());

/** Wake phrases in text as people see it. Offsets index into the original string. A directly following comma joins the span. */
export function findWakeSpans(text: string): TextSpan[] {
  return findWakeMatches(lowerAscii(text)).map((m) => ({ start: m.start, end: text[m.end] === ',' ? m.end + 1 : m.end }));
}

const SPEECH_CHAR = /[\p{L}\p{N}\s#'.,!?:;-]/u;
const SPACE = /\s/;

/** normalizeSpeech, plus a map from each output index back to the input index. */
export function normalizeWithMap(text: string): { out: string; map: number[] } {
  let out = '';
  const map: number[] = [];
  let prevSpace = true;
  for (let i = 0; i < text.length; i++) {
    let ch = text[i].toLowerCase();
    // A few letters lowercase to two characters; keeping the original keeps the map one to one.
    if (ch.length !== 1) ch = text[i];
    if (!SPEECH_CHAR.test(ch)) ch = ' ';
    if (SPACE.test(ch)) {
      if (prevSpace) continue;
      ch = ' ';
      prevSpace = true;
    } else prevSpace = false;
    out += ch;
    map.push(i);
  }
  while (out.endsWith(' ')) {
    out = out.slice(0, -1);
    map.pop();
  }
  return { out, map };
}

/** Where a stored (normalized) command was said: the wake phrase before it and the original span, or null. */
export function locateCommand(transcript: string, command: string): { wake: TextSpan; said: TextSpan } | null {
  if (!command.trim()) return null;
  const { out, map } = normalizeWithMap(transcript);
  const probe = command.slice(0, 60);
  for (const w of findWakeMatches(out)) {
    let from = w.end;
    while (from < out.length && /[\s,.!?:;-]/.test(out[from])) from++;
    if (out.startsWith(probe, from)) {
      const last = Math.min(from + command.length, out.length) - 1;
      return { wake: { start: map[w.start], end: map[w.end - 1] + 1 }, said: { start: map[from], end: map[last] + 1 } };
    }
  }
  return null;
}
