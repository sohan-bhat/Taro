import { test } from 'node:test';
import assert from 'node:assert/strict';
import { matchChannel } from './slack';

const resolve = (spoken: string, channels: string[]) =>
  matchChannel(spoken, channels.map((name) => ({ name })))?.channel.name ?? null;

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

test('a name with nothing left after normalizing matches nothing', () => {
  assert.equal(resolve('#', ['a', 'general']), null);
  assert.equal(resolve('  ', ['a']), null);
});
