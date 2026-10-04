'use client';

import * as React from 'react';

// Where the stage pins: wide screens with the meeting beside the card, and tall tablets with it above.
// Never with reduced motion. Everywhere else, and without this script, the steps are a plain list.
const PIN = [
  '(min-width: 1100px) and (min-height: 620px) and (prefers-reduced-motion: no-preference)',
  '(min-width: 768px) and (min-height: 960px) and (prefers-reduced-motion: no-preference)',
].join(', ');
const SIDE_BY_SIDE = '(min-width: 1100px)';
// The sticky nav's height. The stage pins just under it.
const NAV = 72;
// The first step is already on stage when the stage pins, and the last stays as it scrolls away.
const FIRST = 0.3;
const LAST = 0.8;
// Where focus lands within a step's stretch of the scroll: everything in, nothing leaving yet.
const HOLD = 0.8;

/**
 * The #how story. While pinned, the stage stays put under the nav and the scroll plays the meeting:
 * each frame this writes every step's progress through its own stretch, from 0 to 1, onto its meeting
 * (--t, which the words inherit) and its card (--ct, with the next step's as --cn, neither inherited,
 * so the card's insides are never restyled). globals.css turns them into opacity and transform.
 * Layout is only read when the size changes or the fonts arrive, never while scrolling. All steps
 * stay in the DOM, in order.
 */
export function Story({ steps, children }: { steps: number; children: React.ReactNode }) {
  const ref = React.useRef<HTMLDivElement>(null);

  React.useEffect(() => {
    const story = ref.current;
    const stage = story?.firstElementChild;
    if (!story || !(stage instanceof HTMLElement)) return;
    const items = Array.from(story.querySelectorAll<HTMLElement>('[data-step]'));
    const meetings = items.map((el) => el.querySelector<HTMLElement>('.story-meeting'));
    const cards = items.map((el) => el.querySelector<HTMLElement>('.story-card'));
    // Where in its stretch each step's result lands (set on the step by the server)
    const lands = items.map((el) => Number(el.style.getPropertyValue('--land')) || 0);
    const pin = window.matchMedia(PIN);
    const side = window.matchMedia(SIDE_BY_SIDE);
    let pinned = false;
    let start = 0;
    let distance = 1;
    let frame = 0;
    let shown = -1;
    let carded = -1;
    // What each step was last given, so a frame only writes what changed (most steps sit at -1 or 2)
    let written: string[] = [];

    const mark = (attr: string, from: number, to: number) => {
      if (from === to) return to;
      items[from]?.removeAttribute(attr);
      items[to]?.setAttribute(attr, '');
      return to;
    };

    const update = () => {
      frame = 0;
      if (!pinned) return;
      const p = Math.min(1, Math.max(0, (window.scrollY - start) / distance));
      const ts = items.map((_, i) => {
        let t = p * steps - i;
        if (i === 0) t = Math.max(t, FIRST);
        if (i === items.length - 1) t = Math.min(t, LAST);
        return Math.min(2, Math.max(-1, t));
      });
      items.forEach((_, i) => {
        const t = ts[i].toFixed(3);
        const tn = (ts[i + 1] ?? -1).toFixed(3);
        if (written[i] === t + tn) return;
        written[i] = t + tn;
        meetings[i]?.style.setProperty('--t', t);
        cards[i]?.style.setProperty('--ct', t);
        cards[i]?.style.setProperty('--cn', tn);
      });
      // Only the meeting on stage and the card that's showing take the pointer
      shown = mark('data-shown', shown, Math.min(items.length - 1, Math.floor(p * steps)));
      carded = mark('data-carded', carded, ts.reduce((last, t, i) => (t >= lands[i] ? i : last), 0));
    };

    const measure = () => {
      pinned = pin.matches;
      written = [];
      story.toggleAttribute('data-pinned', pinned);
      story.style.removeProperty('--meeting');
      cards.forEach((card) => card?.style.removeProperty('--fit'));
      if (!pinned) {
        items.forEach((el, i) => {
          meetings[i]?.style.removeProperty('--t');
          cards[i]?.style.removeProperty('--ct');
          cards[i]?.style.removeProperty('--cn');
          el.removeAttribute('data-shown');
          el.removeAttribute('data-carded');
        });
        shown = carded = -1;
        return;
      }
      // Stacked, every meeting takes the tallest one's height, so the cards line up. A card taller
      // than the room left shrinks to fit.
      const grid = getComputedStyle(items[0].firstElementChild as HTMLElement);
      const pad = parseFloat(grid.paddingTop) + parseFloat(grid.paddingBottom);
      let room = stage.clientHeight - pad;
      if (!side.matches) {
        const tallest = Math.max(...meetings.map((meeting) => meeting?.offsetHeight ?? 0));
        story.style.setProperty('--meeting', `${tallest}px`);
        room -= tallest + (parseFloat(grid.rowGap) || 0);
      }
      cards.forEach((card) => {
        if (card?.offsetHeight) card.style.setProperty('--fit', Math.min(1, Math.max(0.6, room / card.offsetHeight)).toFixed(3));
      });
      // Layout offsets, not the bounding box, so the section's intro fade-up can't shift the start
      let top = 0;
      for (let el: HTMLElement | null = story; el; el = el.offsetParent as HTMLElement | null) top += el.offsetTop;
      start = top - NAV;
      distance = Math.max(1, story.offsetHeight - stage.offsetHeight);
      update();
    };

    const onScroll = () => {
      if (!frame) frame = window.requestAnimationFrame(update);
    };
    let resizing = 0;
    const onResize = () => {
      window.cancelAnimationFrame(resizing);
      resizing = window.requestAnimationFrame(measure);
    };

    // Focus inside a step that isn't on stage (the issue's marked words, say) scrolls to that step.
    const onFocus = (event: FocusEvent) => {
      if (!pinned || !(event.target instanceof Element)) return;
      const target = event.target;
      const i = items.findIndex((el) => el.contains(target));
      if (i < 0 || (target.closest('.story-card') ? i === carded : i === shown)) return;
      window.scrollTo({ top: start + ((i + HOLD) / steps) * distance, behavior: 'instant' as ScrollBehavior });
    };

    let live = true;
    measure();
    // Line heights settle once the fonts arrive
    document.fonts?.ready.then(() => live && measure());
    window.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('resize', onResize);
    pin.addEventListener('change', measure);
    side.addEventListener('change', measure);
    story.addEventListener('focusin', onFocus);
    return () => {
      live = false;
      window.cancelAnimationFrame(frame);
      window.cancelAnimationFrame(resizing);
      window.removeEventListener('scroll', onScroll);
      window.removeEventListener('resize', onResize);
      pin.removeEventListener('change', measure);
      side.removeEventListener('change', measure);
      story.removeEventListener('focusin', onFocus);
    };
  }, [steps]);

  return (
    <div ref={ref} className="story" style={{ '--steps': steps } as React.CSSProperties}>
      <div className="story-stage">{children}</div>
    </div>
  );
}
