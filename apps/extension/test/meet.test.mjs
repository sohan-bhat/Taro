import { test } from 'node:test';
import assert from 'node:assert/strict';
import { meetingCodeFromPath, meetingUrlFromCode, originOf } from '../src/lib/meet.js';

test('finds the meeting code in room paths only', () => {
  assert.equal(meetingCodeFromPath('/abc-defg-hij'), 'abc-defg-hij');
  assert.equal(meetingCodeFromPath('/ABC-DEFG-HIJ'), 'abc-defg-hij');
  assert.equal(meetingCodeFromPath('/abc-defg-hij/'), 'abc-defg-hij');
  assert.equal(meetingCodeFromPath('/abc-defg-hij?authuser=1'), null);
  assert.equal(meetingCodeFromPath('/landing'), null);
  assert.equal(meetingCodeFromPath('/'), null);
  assert.equal(meetingCodeFromPath('/abc-defg-hijk'), null);
  assert.equal(meetingCodeFromPath('/ab-defg-hij'), null);
  assert.equal(meetingCodeFromPath(undefined), null);
});

test('rebuilds the join link from a code and refuses anything else', () => {
  assert.equal(meetingUrlFromCode('abc-defg-hij'), 'https://meet.google.com/abc-defg-hij');
  assert.throws(() => meetingUrlFromCode('abc-defg-hij/../../evil'));
  assert.throws(() => meetingUrlFromCode('https://evil.example'));
});

test('normalizes a Taro address to its origin', () => {
  assert.equal(originOf('https://taro.example.com/dashboard'), 'https://taro.example.com');
  assert.equal(originOf(' http://localhost:3100 '), 'http://localhost:3100');
  assert.equal(originOf('javascript:alert(1)'), null);
  assert.equal(originOf('not a url'), null);
});
