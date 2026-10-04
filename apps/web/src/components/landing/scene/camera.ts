// The #how camera's math, kept pure so it can be tested. Rectangles are in scene px; the frame is
// the part of the stage a shot may fill, in stage px. A camera is the scene point at the frame's
// center and the zoom, so it becomes the transform translate(cx - x·z, cy - y·z) scale(z).

import type { Placed } from './script';

export interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface Cam {
  x: number;
  y: number;
  z: number;
}

/** A shot fitted to the frame: the camera at the start and the end of its dwell (equal unless it scans). */
export interface Framed {
  glideFrom: number;
  dwellFrom: number;
  end: number;
  from: Cam;
  to: Cam;
}

// How far a glide may carry the subject across the screen, as a share of the frame, before the
// camera pulls back on the way so the move reads as one shot instead of a whip pan.
const REACH = 0.6;
// A scanning dwell holds at each end for this share of its length.
const SCAN_HOLD = 0.15;

const clamp01 = (n: number) => Math.min(1, Math.max(0, n));
export const smoothstep = (e: number) => e * e * (3 - 2 * e);
export const smootherstep = (e: number) => e * e * e * (e * (e * 6 - 15) + 10);

// The frame the shot list's caps are set for: a 1440 by 900 window's
const REFERENCE = { w: 1344, h: 692 };

/**
 * Frames a target: centered, or sitting on the frame's bottom edge with what's above it in view, as
 * close as `max` allows, with `pad` screen px clear around it. A frame bigger than the reference raises
 * the cap with it, so a close shot on a large screen is still closer than the wide one. When `min`
 * holds the camera closer than the target fits, the target is cropped at the sides and scanned from
 * its top to its bottom.
 */
export function framing(target: Box, frame: Box, shot: Pick<Placed, 'pad' | 'max' | 'min' | 'align'>): { from: Cam; to: Cam } {
  const fit = Math.min((frame.w - 2 * shot.pad) / target.w, (frame.h - 2 * shot.pad) / target.h);
  const grow = Math.max(1, Math.min(frame.w / REFERENCE.w, frame.h / REFERENCE.h));
  const z = Math.max(shot.min ?? 0, Math.min((shot.max ?? Infinity) * grow, fit));
  const x = target.x + target.w / 2;
  // Half the frame's height inside the padding, in scene px
  const half = (frame.h / 2 - shot.pad) / z;
  const top = target.y + half;
  const bottom = target.y + target.h - half;
  if (bottom <= top) {
    const held = { x, y: shot.align === 'bottom' ? bottom : target.y + target.h / 2, z };
    return { from: held, to: held };
  }
  return { from: { x, y: top, z }, to: { x, y: bottom, z } };
}

/** The transform that puts a camera's point at the frame's center. */
export function transform(cam: Cam, frame: Box) {
  return {
    x: frame.x + frame.w / 2 - cam.x * cam.z,
    y: frame.y + frame.h / 2 - cam.y * cam.z,
    z: cam.z,
  };
}

/**
 * The camera `e` of the way (already eased) from a to b. Zoom moves evenly in log space. One point
 * between the two subjects, nearer the closer shot's, slides evenly across the screen, so a push in
 * homes in on its subject and a pull back lets go of its own. A move longer than REACH frames dips
 * the zoom in the middle.
 */
export function glide(a: Cam, b: Cam, e: number, frame: Box): Cam {
  const la = Math.log(a.z);
  const lb = Math.log(b.z);
  const near = Math.min(a.z, b.z);
  const travel = Math.max((Math.abs(b.x - a.x) * near) / frame.w, (Math.abs(b.y - a.y) * near) / frame.h);
  const dip = travel > REACH ? Math.min(0, Math.log(near * Math.sqrt(REACH / travel)) - (la + lb) / 2) : 0;
  const z = Math.exp(la + (lb - la) * e + 4 * dip * e * (1 - e));

  const w = (b.z * b.z) / (a.z * a.z + b.z * b.z);
  const px = a.x + (b.x - a.x) * w;
  const py = a.y + (b.y - a.y) * w;
  // The anchor's offset from the frame's center, in screen px, under each camera
  const sx = (px - a.x) * a.z * (1 - e) + (px - b.x) * b.z * e;
  const sy = (py - a.y) * a.z * (1 - e) + (py - b.y) * b.z * e;
  return { x: px - sx / z, y: py - sy / z, z };
}

/** Where the camera is at story time t. */
export function cameraAt(t: number, shots: readonly Framed[], frame: Box): Cam {
  let last = shots[0].from;
  for (const shot of shots) {
    if (t < shot.dwellFrom) {
      const e = clamp01((t - shot.glideFrom) / (shot.dwellFrom - shot.glideFrom));
      return glide(last, shot.from, smootherstep(e), frame);
    }
    if (t < shot.end) {
      if (shot.from === shot.to) return shot.from;
      const e = clamp01(((t - shot.dwellFrom) / (shot.end - shot.dwellFrom) - SCAN_HOLD) / (1 - 2 * SCAN_HOLD));
      const s = smoothstep(e);
      return { x: shot.from.x, y: shot.from.y + (shot.to.y - shot.from.y) * s, z: shot.from.z };
    }
    last = shot.to;
  }
  return last;
}
