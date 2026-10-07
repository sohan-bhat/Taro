'use client';

import { useEffect } from 'react';

// Any of these ends the intro at once, so nobody waits on it
const INPUTS = ['scroll', 'wheel', 'keydown', 'pointerdown', 'touchstart'] as const;

/**
 * Marks the first screen's intro done (html[data-intro="done"]) when its CSS sequence has run its
 * `ms`, or at once on any scroll, key, click, or tap; globals.css then shows everything still on its
 * way in. Without this script the CSS sequence simply plays to the end.
 */
export function IntroDone({ ms }: { ms: number }) {
  useEffect(() => {
    const root = document.documentElement;
    if (root.dataset.intro === 'done') return;
    let timer = 0;
    const stop = () => {
      window.clearTimeout(timer);
      INPUTS.forEach((type) => window.removeEventListener(type, done));
    };
    const done = () => {
      root.dataset.intro = 'done';
      stop();
    };
    // Timed from the headline's first line, which started with the sequence. A page that's already
    // scrolled, or that asks for less motion, has nothing to wait for.
    const first = document.querySelector('.intro .in-focus')?.getAnimations()[0];
    const started = typeof first?.startTime === 'number' ? first.startTime : performance.now();
    const left = started + ms - performance.now();
    if (left <= 0 || window.scrollY > 0 || window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      done();
      return;
    }
    timer = window.setTimeout(done, left);
    INPUTS.forEach((type) => window.addEventListener(type, done, { passive: true }));
    return stop;
  }, [ms]);

  return null;
}
