'use client';

import * as React from 'react';
import { cameraAt, framing, transform, type Box, type Cam, type Framed } from './scene/camera';
import { NEVER, PLACED, TOTAL } from './scene/script';

// The sticky nav's height. The stage pins just under it.
const NAV = 72;
// The camera runs on any screen tall enough for its close shots, never with reduced motion. Elsewhere,
// and without this script, the story is the plain list.
const CAMERA = '(prefers-reduced-motion: no-preference) and (min-height: 500px)';
// Once the camera has held still this long, the scene drops its compositing hint, so the browser
// repaints its text sharp at the current zoom instead of scaling a bitmap.
const SETTLE = 150;
// Story time past a piece's last cue that its slowest fade can still be running
const FADES = 10;

/** Where an element sits in the scene, unscaled: layout offsets, which the camera's transform doesn't touch. */
function rectIn(el: HTMLElement, scene: HTMLElement): Box {
  let x = 0;
  let y = 0;
  for (let n: HTMLElement | null = el; n && n !== scene; n = n.offsetParent as HTMLElement | null) {
    x += n.offsetLeft;
    y += n.offsetTop;
  }
  return { x, y, w: el.offsetWidth, h: el.offsetHeight };
}

interface Track {
  el: HTMLElement;
  // The stretches of story time in which it changes, in order. Between them it holds still.
  spans: Array<[number, number]>;
  // The --t it was last given
  last: string;
}

/**
 * Every piece of the stage that changes with the story (globals.css), and when. Read once from the
 * cues the server wrote on them. "Already there" and "never leaves" are far outside the story.
 */
function tracks(stage: HTMLElement): Track[] {
  const cues = (el: Element, names: string[]) =>
    names.map((name) => parseFloat((el as HTMLElement).style.getPropertyValue(name))).filter((n) => Math.abs(n) < NEVER);
  return Array.from(stage.querySelectorAll<HTMLElement>('[style*="--at"], [style*="--back"], .spoken')).map((el) => {
    // A spoken line is timed by its words and its heard mark
    const points = el.classList.contains('spoken')
      ? [...cues(el, ['--wake']), ...Array.from(el.querySelectorAll('.word')).flatMap((word) => cues(word, ['--cue']))]
      : cues(el, ['--at', '--out', '--back']);
    const spans: Array<[number, number]> = [];
    for (const point of points.sort((a, b) => a - b)) {
      const last = spans[spans.length - 1];
      if (last && point - 1 <= last[1]) last[1] = point + FADES;
      else spans.push([point - 1, point + FADES]);
    }
    return { el, spans: spans.length ? spans : [[0, 0]], last: '' };
  });
}

/** The story time a piece is shown at: t inside one of its spans, else the end of the last span before t. */
function held(spans: Array<[number, number]>, t: number) {
  let value = spans[0][0];
  for (const [from, to] of spans) {
    if (t < from) break;
    value = Math.min(t, to);
  }
  return value;
}

/**
 * The #how story's camera. While the stage is pinned, the scroll position picks a point in the shot
 * list (scene/script.ts), and the camera is written as one transform on the scene. That point is also
 * --t, the story's progress, which every piece that appears reads in CSS (globals.css). Each piece is
 * given --t clamped to the stretch in which it changes, so a frame restyles only the pieces that are
 * changing, not the whole scene. Targets are measured, and fitted to the stage, only on load, on
 * resize, and when fonts arrive; a scroll frame reads nothing but the scroll position. No React state
 * changes after mount.
 */
export function Story({ children }: { children: React.ReactNode }) {
  const ref = React.useRef<HTMLDivElement>(null);

  React.useEffect(() => {
    const story = ref.current;
    const stage = story?.querySelector<HTMLElement>('.story-stage');
    const band = story?.querySelector<HTMLElement>('.story-band');
    const scene = story?.querySelector<HTMLElement>('.story-scene');
    if (!story || !stage || !band || !scene) return;
    // The list's marked phrases take focus to show who said them. Hidden behind the scene, they mustn't.
    const marks = Array.from(story.querySelectorAll<HTMLElement>('.story-list [tabindex="0"]'));
    const pieces = tracks(stage);
    const media = window.matchMedia(CAMERA);
    let on = false;
    let start = 0;
    let unit = 1;
    let frame: Box = { x: 0, y: 0, w: 1, h: 1 };
    let shots: Framed[] = [];
    let cam: Cam = { x: 0, y: 0, z: 1 };
    let frameId = 0;
    let resizing = 0;
    let settle = 0;
    let moving = false;
    // The camera last written, so a frame that doesn't move it writes nothing
    let still = '';

    const write = (sharp: boolean) => {
      const { x, y, z } = transform(cam, frame);
      const px = (n: number) => (sharp ? Math.round(n * window.devicePixelRatio) / window.devicePixelRatio : n).toFixed(2);
      scene.style.transform = `translate(${px(x)}px, ${px(y)}px) scale(${z.toFixed(4)})`;
    };

    // At rest the scene is repainted at its zoom, on whole device pixels
    const rest = () => {
      moving = false;
      scene.style.removeProperty('will-change');
      write(true);
    };

    const update = () => {
      frameId = 0;
      if (!on) return;
      const t = Math.min(TOTAL, Math.max(0, (window.scrollY - start) / unit));
      for (const piece of pieces) {
        const value = held(piece.spans, t).toFixed(2);
        if (value !== piece.last) piece.el.style.setProperty('--t', (piece.last = value));
      }
      cam = cameraAt(t, shots, frame);
      const key = `${cam.x.toFixed(2)} ${cam.y.toFixed(2)} ${cam.z.toFixed(4)}`;
      if (key === still) return;
      still = key;
      if (!moving) {
        moving = true;
        scene.style.willChange = 'transform';
      }
      write(false);
      window.clearTimeout(settle);
      settle = window.setTimeout(rest, SETTLE);
    };

    const measure = () => {
      on = media.matches;
      story.toggleAttribute('data-camera', on);
      marks.forEach((mark) => (mark.tabIndex = on ? -1 : 0));
      window.clearTimeout(settle);
      moving = false;
      still = '';
      pieces.forEach((piece) => (piece.last = ''));
      if (!on) {
        pieces.forEach((piece) => piece.el.style.removeProperty('--t'));
        scene.style.removeProperty('transform');
        scene.style.removeProperty('will-change');
        return;
      }
      // The frame: the stage below the band that holds the heading and each shot's line
      const w = stage.clientWidth;
      const h = stage.clientHeight;
      const phone = w < 768;
      const side = phone ? 16 : w < 1100 ? 32 : 48;
      const top = band.offsetHeight + (phone ? 4 : 8);
      frame = { x: side, y: top, w: w - 2 * side, h: h - top - (phone ? 12 : 24) };
      const desk = { x: 0, y: 0, w: scene.offsetWidth, h: scene.offsetHeight };
      shots = PLACED.map((shot) => {
        const target = scene.querySelector<HTMLElement>(`[data-cam="${shot.target}"]`);
        return { ...shot, ...framing(target ? rectIn(target, scene) : desk, frame, shot) };
      });
      // Layout offsets, not the bounding box, so the section's intro fade-up can't shift the start
      let y = 0;
      for (let el: HTMLElement | null = story; el; el = el.offsetParent as HTMLElement | null) y += el.offsetTop;
      start = y - NAV;
      unit = Math.max(1, story.offsetHeight - stage.offsetHeight) / TOTAL;
      update();
      // Nothing is moving yet, so start sharp
      window.clearTimeout(settle);
      rest();
    };

    const onScroll = () => {
      if (!frameId) frameId = window.requestAnimationFrame(update);
    };
    const onResize = () => {
      window.cancelAnimationFrame(resizing);
      resizing = window.requestAnimationFrame(measure);
    };

    let live = true;
    measure();
    // Text settles once the fonts arrive, and the Slack face loads only once the scene shows
    document.fonts?.ready.then(() => live && measure());
    document.fonts?.addEventListener('loadingdone', onResize);
    window.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('resize', onResize);
    media.addEventListener('change', measure);
    return () => {
      live = false;
      window.cancelAnimationFrame(frameId);
      window.cancelAnimationFrame(resizing);
      window.clearTimeout(settle);
      document.fonts?.removeEventListener('loadingdone', onResize);
      window.removeEventListener('scroll', onScroll);
      window.removeEventListener('resize', onResize);
      media.removeEventListener('change', measure);
    };
  }, []);

  return (
    <div ref={ref} className="story" style={{ '--runway': TOTAL } as React.CSSProperties}>
      {children}
    </div>
  );
}
