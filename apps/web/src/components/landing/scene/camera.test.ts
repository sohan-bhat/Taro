import assert from 'node:assert/strict';
import { test } from 'node:test';
import { cameraAt, framing, glide, transform, type Box, type Framed } from './camera';
import { PLACED, SHOTS, TOTAL, at } from './script';

// The frame of a 1440 by 900 window, which the shot list's caps are set for
const FRAME: Box = { x: 48, y: 113, w: 1344, h: 692 };
const close = (a: number, b: number, eps = 1e-6) => assert.ok(Math.abs(a - b) < eps, `${a} is not ${b}`);

test('a framed target sits centered in the frame, padded, and no closer than max', () => {
  const target = { x: 100, y: 200, w: 400, h: 100 };
  const { from, to } = framing(target, FRAME, { pad: 20, max: 2 });
  assert.equal(from, to);
  assert.equal(from.z, 2);
  const t = transform(from, FRAME);
  // The target's center lands on the frame's center
  close(t.x + 300 * t.z, FRAME.x + FRAME.w / 2);
  close(t.y + 250 * t.z, FRAME.y + FRAME.h / 2);
  // Without a cap it fits the padded frame exactly
  assert.equal(framing(target, FRAME, { pad: 20 }).from.z, (1344 - 40) / 400);
  // A frame twice the size doubles the cap, so a close shot stays closer than the wide one
  const big = { x: 0, y: 0, w: 2688, h: 1384 };
  assert.equal(framing(target, big, { pad: 20, max: 2 }).from.z, 4);
});

test('a target too tall to read in one frame is scanned from its top to its bottom', () => {
  const phone: Box = { x: 16, y: 90, w: 358, h: 480 };
  const target = { x: 0, y: 0, w: 340, h: 700 };
  const { from, to } = framing(target, phone, { pad: 8, min: 1 });
  assert.equal(from.z, 1);
  // At the start its top edge sits at the frame's top, padded; at the end its bottom at the bottom
  close(transform(from, phone).y, phone.y + 8);
  close(transform(to, phone).y + 700, phone.y + phone.h - 8);
});

test('a glide starts and ends exactly on its shots, and pulls back on a long move', () => {
  const a = { x: 200, y: 800, z: 1.4 };
  const b = { x: 1200, y: 300, z: 1.3 };
  for (const [e, cam] of [[0, a], [1, b]] as const) {
    const g = glide(a, b, e, FRAME);
    close(g.x, cam.x);
    close(g.y, cam.y);
    close(g.z, cam.z);
  }
  assert.ok(glide(a, b, 0.5, FRAME).z < 1.3, 'expected the zoom to dip mid-move');
  // A short move doesn't dip
  const c = { x: 260, y: 820, z: 1.3 };
  close(glide(a, c, 0.5, FRAME).z, Math.sqrt(1.4 * 1.3));
});

test('the camera holds through each dwell and moves only in glides', () => {
  const shots: Framed[] = [
    { glideFrom: 0, dwellFrom: 0, end: 10, from: { x: 0, y: 0, z: 1 }, to: { x: 0, y: 0, z: 1 } },
    { glideFrom: 10, dwellFrom: 30, end: 50, from: { x: 500, y: 0, z: 2 }, to: { x: 500, y: 0, z: 2 } },
  ];
  assert.deepEqual(cameraAt(5, shots, FRAME), shots[0].from);
  assert.deepEqual(cameraAt(40, shots, FRAME), shots[1].from);
  assert.deepEqual(cameraAt(99, shots, FRAME), shots[1].to);
  const mid = cameraAt(20, shots, FRAME);
  assert.ok(mid.x > 0 && mid.x < 500 && mid.z > 1 && mid.z < 2);
});

test('the shot list is continuous and every cue lands inside the story', () => {
  assert.equal(PLACED[0].glideFrom, 0);
  for (let i = 1; i < PLACED.length; i++) assert.equal(PLACED[i].glideFrom, PLACED[i - 1].end);
  assert.equal(TOTAL, SHOTS.reduce((sum, s) => sum + s.glide + s.dwell, 0));
  assert.equal(at('end', 24), TOTAL);
});
