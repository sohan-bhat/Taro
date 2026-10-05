import { test } from 'node:test';
import assert from 'node:assert/strict';
import { controlView, noticeFor, noticeKind } from '../src/lib/control.js';

const meeting = (status, extra = {}) => ({ id: 'm', status, ...extra });
const starting = meeting('joining', { joinStage: 'starting' });
const lobby = meeting('joining', { joinStage: 'lobby' });

// Every state the button can be in: the words on it (also its accessible name), its tooltip, what a click does, and its look.
const STATES = [
  ['not connected', { connected: false }, 'Connect Taro', 'Connect Taro to this browser', 'connect', 'rest'],
  ['signed out', { connected: false, expired: true }, 'Reconnect', 'Reconnect Taro', 'connect', 'rest'],
  ['ready', { connected: true }, 'Invite Taro', 'Invite Taro', 'invite', 'rest'],
  ['sending', { connected: true, sending: true }, 'Joining', 'Taro is joining', 'none', 'progress'],
  ['pending', { connected: true, meeting: meeting('pending') }, 'Joining', 'Taro is joining', 'menu', 'progress'],
  ['bot starting', { connected: true, meeting: starting }, 'Joining', 'Taro is joining', 'menu', 'progress'],
  ['in the lobby', { connected: true, meeting: lobby }, 'In the lobby', 'Waiting for someone to admit Taro', 'menu', 'progress'],
  ['in the lobby, older server', { connected: true, meeting: meeting('joining') }, 'In the lobby', 'Waiting for someone to admit Taro', 'menu', 'progress'],
  ['in the call', { connected: true, meeting: meeting('active') }, 'Listening', 'Taro is listening', 'menu', 'on'],
  ['turned away', { connected: true, meeting: meeting('error', { errorMessage: 'Nobody admitted Taro.' }) }, 'Try again', 'Taro couldn’t join. Try again', 'retry', 'rest'],
  ['request failed', { connected: true, error: 'Taro answered 500.' }, 'Try again', 'Taro couldn’t join. Try again', 'retry', 'rest'],
  ['left', { connected: true, meeting: meeting('ended') }, 'Invite Taro', 'Invite Taro', 'invite', 'rest'],
];

for (const [name, input, label, tip, action, look] of STATES) {
  test(`${name}: "${label}", ${action}, ${look}`, () => {
    const v = controlView(input);
    assert.equal(v.label, label);
    assert.equal(v.tip, tip);
    assert.equal(v.action, action);
    assert.equal(v.look, look);
    assert.equal(v.menu.length > 0, action === 'menu', 'only menu states carry menu items');
  });
}

test('no label is longer than Connect Taro, so the button keeps its words as Taro moves through its states', () => {
  for (const [, input] of STATES) {
    const v = controlView(input);
    assert.ok(v.label.length <= 'Connect Taro'.length, `short: ${v.label}`);
    assert.ok(v.tip.length >= v.label.length, `the tooltip says at least as much: ${v.tip}`);
  }
});

test('once Taro is on its way the mark says whose button it is, so the words drop the name; the tooltip keeps the full sentence', () => {
  for (const [input, label, tip] of [
    [{ connected: true, meeting: starting }, 'Joining', 'Taro is joining'],
    [{ connected: true, meeting: lobby }, 'In the lobby', 'Waiting for someone to admit Taro'],
    [{ connected: true, meeting: meeting('active') }, 'Listening', 'Taro is listening'],
    [{ connected: false, expired: true }, 'Reconnect', 'Reconnect Taro'],
  ]) {
    const v = controlView(input);
    assert.equal(v.label, label);
    assert.equal(v.tip, tip);
  }
});

test('a sign-out wins over everything else, even mid-call', () => {
  assert.equal(controlView({ connected: true, expired: true, meeting: meeting('active') }).label, 'Reconnect');
  assert.equal(controlView({ connected: false, sending: true }).action, 'connect');
});

test('the menu offers Remove Taro and Open in Taro, and the last answer once Taro is listening', () => {
  const live = controlView({ connected: true, meeting: meeting('active', { lastAnswer: 'Opened issue #42 in acme/web.' }) });
  assert.deepEqual(live.menu.map((i) => [i.id, i.label]), [['leave', 'Remove Taro'], ['open', 'Open in Taro']]);
  assert.equal(live.answer, 'Opened issue #42 in acme/web.');
  assert.equal(controlView({ connected: true, meeting: meeting('active') }).answer, undefined);
  assert.equal(controlView({ connected: true, meeting: { ...lobby, lastAnswer: 'x' } }).answer, undefined);
});

test('a live meeting outranks a stale request error', () => {
  assert.equal(controlView({ connected: true, error: 'x', meeting: meeting('active') }).label, 'Listening');
});

test('inviting says what happens next', () => {
  const sending = { connected: true, sending: true };
  const onItsWay = 'Taro is on its way. Admit it when it asks to join.';
  assert.equal(noticeFor('invite', sending, { connected: true, meeting: starting }), onItsWay);
  assert.equal(noticeFor('invite', sending, { connected: true, meeting: meeting('pending') }), onItsWay);
  assert.equal(noticeFor('invite', sending, { connected: true, meeting: meeting('joining') }), onItsWay, 'an older server, with no joinStage');
  assert.equal(noticeFor('invite', sending, { connected: true, meeting: lobby }), 'Taro is asking to join. Admit it now.');
  assert.equal(noticeFor('invite', sending, { connected: true, meeting: meeting('active') }), 'Taro is listening. Say “Hey Taro” and what you need.');
  assert.equal(noticeFor('invite', sending, { connected: false, expired: true }), 'Connect this browser to Taro first.');
  assert.equal(noticeFor('invite', sending, null), null);
});

test('a failed invite gives the reason as one sentence', () => {
  const sending = { connected: true, sending: true };
  assert.equal(
    noticeFor('invite', sending, { connected: true, error: 'Taro is already in 3 meetings for this workspace, which is the limit.' }),
    'Taro couldn’t join: Taro is already in 3 meetings for this workspace, which is the limit.'
  );
  assert.equal(noticeFor('invite', sending, { connected: true, meeting: meeting('error', { errorMessage: 'Abandoned' }) }), 'Taro couldn’t join: Abandoned.');
  assert.equal(noticeFor('invite', sending, { connected: true, error: 'Failed to fetch' }), 'Taro couldn’t join: Taro can’t be reached right now.');
  assert.equal(noticeFor('invite', sending, { connected: true, meeting: meeting('error') }), 'Taro couldn’t join. Try again.');
});

test('reaching the lobby is announced once, when the bot starts asking to be let in', () => {
  const asking = 'Taro is asking to join. Admit it now.';
  assert.equal(noticeFor('poll', { connected: true, meeting: starting }, { connected: true, meeting: lobby }), asking);
  assert.equal(noticeFor('poll', { connected: true, meeting: meeting('pending') }, { connected: true, meeting: lobby }), asking);
  assert.equal(noticeFor('poll', { connected: true, meeting: starting }, { connected: true, meeting: starting }), null, 'still starting');
  assert.equal(noticeFor('poll', { connected: true, meeting: lobby }, { connected: true, meeting: lobby }), null, 'no repeat while it waits');
  assert.equal(noticeFor('poll', null, { connected: true, meeting: lobby }), null, 'a page that loads into the lobby stays quiet');
  const older = meeting('joining');
  assert.equal(noticeFor('poll', { connected: true, meeting: older }, { connected: true, meeting: older }), null, 'an older server never sends the change');
});

test('polling announces admission and rejection, once, and only for the meeting it watched', () => {
  const listening = 'Taro is listening. Say “Hey Taro” and what you need.';
  for (const was of [starting, lobby, meeting('joining')]) {
    const waiting = { connected: true, meeting: was };
    assert.equal(noticeFor('poll', waiting, { connected: true, meeting: meeting('active') }), listening);
    assert.equal(
      noticeFor('poll', waiting, { connected: true, meeting: meeting('error', { errorMessage: 'Nobody admitted Taro within 10 minutes.' }) }),
      'Taro couldn’t join: Nobody admitted Taro within 10 minutes.'
    );
    assert.equal(noticeFor('poll', waiting, { connected: true, meeting: { id: 'other', status: 'active' } }), null);
    assert.equal(noticeFor('poll', waiting, { connected: false, expired: true }), null);
  }
  const inCall = { connected: true, meeting: meeting('active') };
  assert.equal(noticeFor('poll', inCall, inCall), null, 'no repeat while Taro stays in');
  assert.equal(noticeFor('poll', null, inCall), null, 'a page that loads mid-call stays quiet');
});

test('removing Taro is quiet unless it fails', () => {
  const inCall = { connected: true, meeting: meeting('active') };
  assert.equal(noticeFor('leave', inCall, { connected: true, meeting: meeting('ended') }), null);
  assert.equal(noticeFor('leave', inCall, { connected: true, meeting: meeting('active'), error: 'Taro answered 502.' }), 'Taro couldn’t leave: Taro answered 502.');
  assert.equal(noticeFor('leave', inCall, { connected: false, expired: true }), 'Connect this browser to Taro first.');
});

test('plain updates pass on their own; notices that ask for something or explain a failure stay longer and offer Dismiss', () => {
  const plain = { ms: 5000, dismiss: false };
  const asks = { ms: 10000, dismiss: true };
  assert.deepEqual(noticeKind('Taro is on its way. Admit it when it asks to join.'), plain);
  assert.deepEqual(noticeKind('Taro is listening. Say “Hey Taro” and what you need.'), plain);
  assert.deepEqual(noticeKind('Taro is asking to join. Admit it now.'), asks);
  assert.deepEqual(noticeKind('Taro couldn’t join: Nobody admitted Taro within 10 minutes.'), asks);
  assert.deepEqual(noticeKind('Taro couldn’t leave: Taro answered 502.'), asks);
  assert.deepEqual(noticeKind('Connect this browser to Taro first.'), asks);
});

test('nothing a person can read uses dashes as punctuation', () => {
  const texts = [];
  for (const [, input] of STATES) {
    const v = controlView(input);
    texts.push(v.label, v.tip, ...v.menu.map((i) => i.label));
  }
  const sending = { connected: true, sending: true };
  for (const after of [
    { connected: true, meeting: starting }, { connected: true, meeting: lobby }, { connected: true, meeting: meeting('active') },
    { connected: false }, { connected: true, error: 'x' }, { connected: true, meeting: meeting('error') },
  ]) texts.push(noticeFor('invite', sending, after) ?? '');
  texts.push(noticeFor('poll', { connected: true, meeting: starting }, { connected: true, meeting: lobby }) ?? '');
  for (const text of texts) {
    assert.ok(!/[–—]/.test(text), `no en or em dash: ${text}`);
    assert.ok(!/\s-\s|\s-$|^-\s/.test(text), `no hyphen as punctuation: ${text}`);
  }
});
