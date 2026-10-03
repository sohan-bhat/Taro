// Newly arrived words in a live transcript, stable across the dashboard's 4 second polls.

/** Splits the latest live transcript into what was already shown and what just arrived. */
export function splitFresh(prev: string, next: string): { settled: string; fresh: string } {
  if (!prev || next === prev) return { settled: next, fresh: '' };
  if (next.startsWith(prev)) return { settled: prev, fresh: next.slice(prev.length) };
  // The API keeps only the last 4000 characters, so the front can fall off. Re-anchor on the old ending.
  const anchor = prev.slice(-40);
  const at = next.lastIndexOf(anchor);
  return at >= 0 ? { settled: next.slice(0, at + anchor.length), fresh: next.slice(at + anchor.length) } : { settled: next, fresh: '' };
}

/** The last `n` characters, cut at a word, with a leading ellipsis when cut. */
export function cutTail(text: string, n: number): string {
  if (text.length <= n) return text;
  const s = text.slice(-n);
  const sp = s.indexOf(' ');
  return `…${sp >= 0 ? s.slice(sp + 1) : s}`;
}

/** What one meeting's live tail last showed. `key` changes only when new words arrive. */
export interface TailState {
  text: string;
  fresh: string;
  key: number;
}

/**
 * The next state for a poll. Keep one per meeting in a ref and render the fresh part in
 * <span key={`${meetingId}:${state.key}`} className="fresh">, so the settle animation runs once per
 * arrival and never restarts on an unchanged poll. Nothing is fresh on the first render.
 */
export function nextTail(prev: TailState | undefined, text: string): TailState {
  if (!prev) return { text, fresh: '', key: text.length };
  if (text === prev.text) return prev;
  return { text, fresh: splitFresh(prev.text, text).fresh, key: text.length };
}

/**
 * The tail to render: `cutTail(text, n)`, with its last `fresh.length` characters (all of it
 * when shorter) split off for the .fresh span.
 */
export function tailParts(state: Pick<TailState, 'text' | 'fresh'>, n: number): { settled: string; fresh: string } {
  const tail = cutTail(state.text, n);
  const freshLength = Math.min(state.fresh.length, tail.length);
  return { settled: tail.slice(0, tail.length - freshLength), fresh: tail.slice(tail.length - freshLength) };
}
