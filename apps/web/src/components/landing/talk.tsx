// The live talk: requests appear the way speech does, as live captions, then Taro answers. Server
// rendered in the final state. The hero plays its cues over time and the #how story scrubs its own
// with the scroll (globals.css); these helpers only place each word, as CSS custom properties.

import * as React from 'react';
import { heardParts } from '@/lib/excerpts';

/** A speaker's name shows just before their first word. */
export const NAME_BEFORE = 150;

/** Sets each value as a millisecond custom property: ms({ d: 300 }) is { '--d': '300ms' }. */
export function ms(times: Record<string, number>): React.CSSProperties {
  return Object.fromEntries(Object.entries(times).map(([name, t]) => [`--${name}`, `${Math.round(t)}ms`])) as React.CSSProperties;
}

/** Keeps the last word with the one before it, so a wrapped line never ends on a lone word like "acme/web." */
export const keepLastWordsTogether = (s: string) => s.replace(/ (?=\S+$)/, ' ');

/** Paces a sentence like talking: a word every `per` ms from `at`, and a beat after a comma or period. */
export function speech(text: string, at: number, per = 150, beat = 120) {
  const words: Array<{ text: string; at: number }> = [];
  let t = at;
  for (const word of text.split(' ')) {
    words.push({ text: word, at: t });
    t += per + (/[,.!?]$/.test(word) ? beat : 0);
  }
  return { words, last: words[words.length - 1].at };
}

/**
 * A request said aloud. Each word stays invisible, holding its place so the line never rewraps,
 * until its cue: a time in the hero, a point in the story's scroll. The heard mark sweeps in just
 * after "Taro," is said. Hidden from screen readers; the caller gives them the sentence once.
 */
export function Spoken({
  text,
  cues,
  unit,
  wakeAfter,
}: {
  text: string;
  // One per word, in `unit`
  cues: number[];
  unit: 'ms' | 'step';
  // How long after the wake phrase's last word the heard mark sweeps in
  wakeAfter: number;
}) {
  const value = (n: number) => (unit === 'ms' ? `${Math.round(n)}ms` : `${Number(n.toFixed(4))}`);
  const words = text.split(' ');

  // The wake phrase's character ranges, so its words can sit inside the heard mark
  const marks: Array<[number, number]> = [];
  let offset = 0;
  for (const part of heardParts(text)) {
    if (part.heard) marks.push([offset, offset + part.text.length]);
    offset += part.text.length;
  }
  let start = 0;
  const heard = words.map((word) => {
    const inMark = marks.some(([from, to]) => start >= from && start + word.length <= to);
    start += word.length + 1;
    return inMark;
  });
  const lastHeard = heard.lastIndexOf(true);
  const wake = lastHeard < 0 ? cues[0] : cues[lastHeard] + wakeAfter;

  // Words and the spaces between them; the last space doesn't break, and a run of heard words
  // shares one mark
  const nodes: React.ReactNode[] = [];
  let mark: React.ReactNode[] = [];
  const closeMark = (key: string) => {
    if (mark.length) nodes.push(<span key={key} className="heard">{mark}</span>);
    mark = [];
  };
  for (let i = 0; i < words.length; i++) {
    const span = (
      <span key={i} className="word" style={{ '--cue': value(cues[i]) } as React.CSSProperties}>
        {words[i]}
      </span>
    );
    const space = i === 0 ? null : i === words.length - 1 ? ' ' : ' ';
    if (heard[i] && mark.length) {
      mark.push(space, span);
      continue;
    }
    closeMark(`mark${i}`);
    if (space) nodes.push(space);
    if (heard[i]) mark.push(span);
    else nodes.push(span);
  }
  closeMark('mark');

  return (
    <span aria-hidden="true" className="spoken" style={{ '--wake': value(wake) } as React.CSSProperties}>
      {nodes}
    </span>
  );
}

/** Hyphenated words never break at the hyphen ("follow-" / "ups"). */
export function KeepCompounds({ text }: { text: string }) {
  return (
    <>
      {text.split(/(\S+-\S+)/).map((part, i) =>
        i % 2 ? (
          <span key={i} className="whitespace-nowrap">
            {part}
          </span>
        ) : (
          part
        )
      )}
    </>
  );
}
