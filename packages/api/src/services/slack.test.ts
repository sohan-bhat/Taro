import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeChannel, channelDistance } from './slack';

// Mirrors resolveChannel's matching: exact, then closest within tolerance.
function resolve(spoken: string, channels: string[]): string | null {
  const target = normalizeChannel(spoken);
  const exact = channels.find((c) => normalizeChannel(c) === target);
  if (exact) return exact;
  let best: string | null = null;
  let bestD = Infinity;
  for (const c of channels) {
    const d = channelDistance(target, normalizeChannel(c));
    if (d < bestD) {
      bestD = d;
      best = c;
    }
  }
  const tolerance = Math.max(1, Math.floor(target.length / 4));
  return best && bestD <= tolerance ? best : null;
}

const CHANNELS = ['social', 'general', 'g-meet-links', 'new-channel', 'engineering'];

test('plural spoken name resolves to singular channel', () => {
  assert.equal(resolve('socials', CHANNELS), 'social');
});

test('exact match wins', () => {
  assert.equal(resolve('general', CHANNELS), 'general');
});

test('spaces and case normalize to hyphenated channel', () => {
  assert.equal(resolve('New Channel', CHANNELS), 'new-channel');
});

test('small typo resolves to closest channel', () => {
  assert.equal(resolve('enginering', CHANNELS), 'engineering');
});

test('genuinely different name does not false-match', () => {
  assert.equal(resolve('marketing', CHANNELS), null);
});

test('both singular exact and plural present: exact wins', () => {
  assert.equal(resolve('social', ['social', 'socials']), 'social');
  assert.equal(resolve('socials', ['social', 'socials']), 'socials');
});
