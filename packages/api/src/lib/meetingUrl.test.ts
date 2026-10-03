import { test } from 'node:test';
import assert from 'node:assert/strict';
import { findMeetingLinks, meetLinkFromCode, normalizeMeetingUrl } from './meetingUrl';

test('normalizes Google Meet links to the room URL', () => {
  assert.deepEqual(normalizeMeetingUrl('https://meet.google.com/abc-defg-hij?authuser=1'), {
    url: 'https://meet.google.com/abc-defg-hij',
    platform: 'google_meet',
  });
});

test('keeps the Zoom passcode', () => {
  const link = normalizeMeetingUrl('https://us02web.zoom.us/j/81234567890?pwd=AbCdEf123');
  assert.equal(link?.platform, 'zoom');
  assert.equal(link?.url, 'https://us02web.zoom.us/j/81234567890?pwd=AbCdEf123');
});

test('accepts Teams meeting links', () => {
  const link = normalizeMeetingUrl(
    'https://teams.microsoft.com/l/meetup-join/19%3ameeting_abc%40thread.v2/0?context=%7b%22Tid%22%3a%22x%22%7d'
  );
  assert.equal(link?.platform, 'teams');
  assert.equal(normalizeMeetingUrl('https://teams.live.com/meet/9876543210?p=abc')?.platform, 'teams');
});

test('rejects lookalike hosts and non-meeting pages', () => {
  assert.equal(normalizeMeetingUrl('https://meet.google.com.evil.com/abc-defg-hij'), null);
  assert.equal(normalizeMeetingUrl('https://zoom.us.evil.com/j/123'), null);
  assert.equal(normalizeMeetingUrl('https://evilzoom.us/j/123'), null);
  assert.equal(normalizeMeetingUrl('https://zoom.us/pricing'), null);
  assert.equal(normalizeMeetingUrl('https://meet.google.com/landing'), null);
  assert.equal(normalizeMeetingUrl('javascript:alert(1)'), null);
  assert.equal(normalizeMeetingUrl('not a url'), null);
});

test('finds links in Slack markup and unescapes ampersands', () => {
  const text =
    'standup now <https://us02web.zoom.us/j/811?pwd=abc&amp;uname=x|Join Zoom> and backup <https://meet.google.com/abc-defg-hij>.';
  const links = findMeetingLinks(text);
  assert.equal(links.length, 2);
  assert.equal(links[0].url, 'https://us02web.zoom.us/j/811?pwd=abc&uname=x');
  assert.equal(links[1].url, 'https://meet.google.com/abc-defg-hij');
});

test('dedupes repeated links and ignores trailing punctuation', () => {
  const links = findMeetingLinks('join https://meet.google.com/abc-defg-hij. again https://meet.google.com/abc-defg-hij');
  assert.equal(links.length, 1);
});

test('stays fast on hostile messages', () => {
  const hostile = [
    `https://a${')'.repeat(39_000)}x`,
    '<https://a|'.repeat(4_000),
    'https://meet.google.com/abc-defg-hij '.repeat(1_100),
  ];
  for (const text of hostile) {
    const started = performance.now();
    findMeetingLinks(text);
    const ms = performance.now() - started;
    assert.ok(ms < 150, `took ${ms.toFixed(0)} ms on a ${text.length} character message`);
  }
});

test('trims a run of prose punctuation after a link', () => {
  const links = findMeetingLinks('meet here (https://meet.google.com/abc-defg-hij)!?');
  assert.equal(links[0]?.url, 'https://meet.google.com/abc-defg-hij');
});

test('builds a Meet link from a bare code and nothing else', () => {
  assert.deepEqual(meetLinkFromCode('ABC-defg-hij'), { url: 'https://meet.google.com/abc-defg-hij', platform: 'google_meet' });
  assert.equal(meetLinkFromCode('abc-defg-hij/../x'), null);
  assert.equal(meetLinkFromCode('https://meet.google.com/abc-defg-hij'), null);
  assert.equal(meetLinkFromCode({ $ne: null }), null);
  assert.equal(meetLinkFromCode(undefined), null);
});
