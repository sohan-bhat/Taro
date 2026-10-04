// The #how story as one shot list. The scene places every cue on it and the camera (story.tsx)
// frames each shot's target, so the two can't drift apart. Lengths are in vh of scroll: a shot glides
// in from the one before, then dwells while its content plays. Scrolling back plays it in reverse.

import type * as React from 'react';

export type ShotId =
  | 'wide'
  | 'join'
  | 'tiles'
  | 'ask-issue'
  | 'issue'
  | 'ask-post'
  | 'posted'
  | 'ask-pull'
  | 'pull'
  | 'branch'
  | 'ask-merge'
  | 'ended'
  | 'recap'
  | 'end';

export interface Shot {
  id: ShotId;
  // The data-cam name of the element to frame
  target: string;
  glide: number;
  dwell: number;
  // Screen px kept clear around the target
  pad: number;
  // The closest the camera comes
  max?: number;
  // Any farther and the text is too small to read, so a target that won't fit is scanned top to bottom
  min?: number;
  // Sit the target on the frame's bottom edge, so what's above it shows (the call's tiles over its captions)
  align?: 'bottom';
}

// Close shots are capped so a short message never fills the screen, and floored so text stays
// readable on phones (Slack is 15px, GitHub 14px, the captions 18px at a scale of 1).
export const SHOTS: readonly Shot[] = [
  { id: 'wide', target: 'desk', glide: 0, dwell: 18, pad: 0 },
  { id: 'join', target: 'slack', glide: 26, dwell: 26, pad: 8, max: 1.4, min: 0.95 },
  { id: 'tiles', target: 'tiles', glide: 20, dwell: 20, pad: 8, max: 1.25 },
  { id: 'ask-issue', target: 'captions', glide: 22, dwell: 78, pad: 8, max: 1.4, min: 0.9, align: 'bottom' },
  { id: 'issue', target: 'github', glide: 30, dwell: 52, pad: 8, max: 1.3, min: 1 },
  { id: 'ask-post', target: 'captions', glide: 30, dwell: 44, pad: 8, max: 1.4, min: 0.9, align: 'bottom' },
  { id: 'posted', target: 'slack', glide: 26, dwell: 24, pad: 8, max: 1.4, min: 0.95 },
  { id: 'ask-pull', target: 'captions', glide: 26, dwell: 58, pad: 8, max: 1.4, min: 0.9, align: 'bottom' },
  { id: 'pull', target: 'github', glide: 30, dwell: 26, pad: 8, max: 1.3, min: 1 },
  { id: 'branch', target: 'branch', glide: 18, dwell: 22, pad: 28, max: 2.2, min: 1.15 },
  { id: 'ask-merge', target: 'merge', glide: 30, dwell: 36, pad: 24, max: 1.7, min: 0.9, align: 'bottom' },
  { id: 'ended', target: 'tiles', glide: 22, dwell: 22, pad: 8, max: 1.2 },
  { id: 'recap', target: 'slack', glide: 26, dwell: 30, pad: 8, max: 1.4, min: 0.95 },
  { id: 'end', target: 'desk', glide: 32, dwell: 24, pad: 0 },
];

/** A shot on the scroll: its glide runs from `glideFrom` to `dwellFrom`, its dwell from there to `end`. */
export interface Placed extends Shot {
  glideFrom: number;
  dwellFrom: number;
  end: number;
}

export const PLACED: readonly Placed[] = (() => {
  let t = 0;
  return SHOTS.map((s) => {
    const glideFrom = t;
    const dwellFrom = (t += s.glide);
    return { ...s, glideFrom, dwellFrom, end: (t += s.dwell) };
  });
})();

/** The whole story, in vh of scroll. */
export const TOTAL = PLACED[PLACED.length - 1].end;

/** A shot's place on the scroll. */
export function shot(id: ShotId) {
  const found = PLACED.find((s) => s.id === id);
  if (!found) throw new Error(`No shot ${id}`);
  return found;
}

/** A point in the story: `offset` into the shot's dwell, or back into its glide when negative. */
export const at = (id: ShotId, offset = 0) => shot(id).dwellFrom + offset;

// Far outside the story: a piece cued here is there from the start, or never leaves
export const NEVER = 100000;
export const ALWAYS = -NEVER;

/**
 * When a piece of the scene arrives and, if it does, leaves, each over `fade`: the custom properties
 * globals.css turns into opacity. All three are always set, so a piece never inherits its parent's.
 */
export function cue(at: number, out = NEVER, fade = 3): React.CSSProperties {
  const round = (n: number) => Math.round(n * 100) / 100;
  return { '--at': round(at), '--out': round(out), '--f': fade } as React.CSSProperties;
}
