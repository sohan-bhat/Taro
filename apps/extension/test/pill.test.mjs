import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pillView } from '../src/lib/pill.js';

test('asks to connect first, and to reconnect after a sign-out', () => {
  assert.equal(pillView({ connected: false }).label, 'Connect Taro');
  assert.equal(pillView({ connected: false }).action, 'connect');
  const expired = pillView({ connected: true, expired: true });
  assert.equal(expired.label, 'Reconnect Taro');
  assert.equal(expired.action, 'connect');
});

test('walks through sending, waiting, and listening', () => {
  assert.equal(pillView({ connected: true }).label, 'Invite Taro');
  assert.equal(pillView({ connected: true, sending: true }).label, 'Sending Taro');
  assert.equal(pillView({ connected: true, sending: true }).busy, true);
  const waiting = pillView({ connected: true, meeting: { id: 'm', status: 'joining' } });
  assert.equal(waiting.label, 'Waiting to be admitted');
  assert.deepEqual(waiting.menu.map((i) => i.id), ['leave', 'open']);
  const live = pillView({ connected: true, meeting: { id: 'm', status: 'active', lastAnswer: 'Opened issue #42 in acme/web.' } });
  assert.equal(live.label, 'Taro is listening');
  assert.equal(live.detail, 'Opened issue #42 in acme/web.');
});

test('explains a failed join and offers to send again', () => {
  const failed = pillView({ connected: true, meeting: { id: 'm', status: 'error', errorMessage: 'Nobody admitted Taro within 10 minutes.' } });
  assert.equal(failed.tone, 'alert');
  assert.equal(failed.detail, 'Nobody admitted Taro within 10 minutes.');
  assert.deepEqual(failed.menu.map((i) => i.id), ['retry', 'dismiss']);
});

test('a finished meeting offers a fresh invite', () => {
  assert.equal(pillView({ connected: true, meeting: { id: 'm', status: 'ended' } }).label, 'Invite Taro');
});

test('labels never use em or en dashes', () => {
  const states = [
    { connected: false }, { connected: true, expired: true }, { connected: true }, { connected: true, sending: true },
    { connected: true, meeting: { id: 'm', status: 'joining' } }, { connected: true, meeting: { id: 'm', status: 'active' } },
    { connected: true, meeting: { id: 'm', status: 'error' } }, { connected: true, error: 'x' },
  ];
  for (const s of states) {
    const v = pillView(s);
    const text = [v.label, v.detail ?? '', ...v.menu.map((i) => i.label)].join(' ');
    assert.ok(!/[–—]/.test(text), text);
  }
});
