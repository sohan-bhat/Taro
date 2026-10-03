import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EnergyVad, SAMPLE_RATE, wavEncode } from './vad';

// 20ms of 16 kHz s16le audio at a constant level
function chunk(level: number, ms = 20): Buffer {
  const n = (SAMPLE_RATE * ms) / 1000;
  const buf = Buffer.alloc(n * 2);
  for (let i = 0; i < n; i++) buf.writeInt16LE(i % 2 === 0 ? level : -level, i * 2);
  return buf;
}

function feed(vad: EnergyVad, level: number, ms: number) {
  for (let t = 0; t < ms; t += 20) vad.push(chunk(level));
}

test('silence never produces a segment', () => {
  const segments: Int16Array[] = [];
  const vad = new EnergyVad((s) => segments.push(s));
  feed(vad, 50, 5000);
  assert.equal(segments.length, 0);
});

test('speech followed by a pause emits one segment including pre-roll', () => {
  const segments: Int16Array[] = [];
  const vad = new EnergyVad((s) => segments.push(s));
  feed(vad, 100, 1000); // quiet lead-in fills the pre-roll
  feed(vad, 3000, 1500); // speech
  feed(vad, 100, 1000); // pause ends it
  assert.equal(segments.length, 1);
  const seconds = segments[0].length / SAMPLE_RATE;
  // 1.5s speech + 0.3s pre-roll + 0.7s hang
  assert.ok(seconds > 2.3 && seconds < 2.7, `got ${seconds}s`);
  // Pre-roll is the quiet audio, in order, right before the speech
  assert.equal(Math.abs(segments[0][0]), 100);
});

test('blips shorter than the minimum are dropped', () => {
  const segments: Int16Array[] = [];
  const vad = new EnergyVad((s) => segments.push(s), { prerollSamples: 0 });
  feed(vad, 3000, 100);
  feed(vad, 50, 300);
  feed(vad, 50, 2000);
  assert.equal(segments.length, 0);
});

test('a long monologue is cut at the maximum length', () => {
  const segments: Int16Array[] = [];
  const vad = new EnergyVad((s) => segments.push(s), { maxSamples: SAMPLE_RATE * 2 });
  feed(vad, 3000, 5000);
  assert.ok(segments.length >= 2);
  for (const s of segments) assert.ok(s.length <= SAMPLE_RATE * 2 + SAMPLE_RATE / 50);
});

test('wavEncode writes a valid 16 kHz mono PCM header', () => {
  const wav = wavEncode(new Int16Array([1, -1, 2]));
  assert.equal(wav.toString('ascii', 0, 4), 'RIFF');
  assert.equal(wav.toString('ascii', 8, 12), 'WAVE');
  assert.equal(wav.readUInt32LE(24), SAMPLE_RATE);
  assert.equal(wav.readUInt32LE(40), 6);
  assert.equal(wav.length, 44 + 6);
});
