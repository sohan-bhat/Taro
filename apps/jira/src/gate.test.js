import { test } from 'node:test';
import assert from 'node:assert/strict';
import { connectionKey, header, readCall, sign, verify } from './gate.js';

const secret = 'x'.repeat(43);
const body = JSON.stringify({ v: 1, method: 'GET', path: '/rest/api/3/serverInfo', query: {}, body: null });

test('accepts a fresh signature and nothing else', () => {
  const now = 1_700_000_000;
  const headers = { 'X-Taro-Timestamp': [String(now)], 'X-Taro-Signature': [sign(secret, now, body)] };
  assert.equal(verify(secret, headers, body, now), true);
  assert.equal(verify(secret, headers, body, now + 301), false);
  assert.equal(verify(secret, headers, `${body} `, now), false);
  assert.equal(verify('other', headers, body, now), false);
  assert.equal(verify(secret, { 'x-taro-timestamp': [String(now)] }, body, now), false);
  assert.equal(verify(undefined, headers, body, now), false);
});

test('reads headers in any case', () => {
  assert.equal(header({ 'X-Taro-Signature': ['abc'] }, 'x-taro-signature'), 'abc');
  assert.equal(header({}, 'x-taro-signature'), undefined);
});

test('passes on only the listed Jira calls', () => {
  const call = (method, path, extra = {}) => readCall(JSON.stringify({ v: 1, method, path, ...extra }));
  assert.deepEqual(call('POST', '/rest/api/3/issue/ENG-12/comment', { body: { body: {} } }), {
    method: 'POST',
    path: '/rest/api/3/issue/ENG-12/comment',
    body: '{"body":{}}',
  });
  assert.equal(call('GET', '/rest/api/3/user/assignable/search', { query: { issueKey: 'ENG-1', query: 'sam', expand: 'x' } }).path,
    '/rest/api/3/user/assignable/search?issueKey=ENG-1&query=sam');
  assert.match(call('DELETE', '/rest/api/3/issue/ENG-12').error, /may not/);
  assert.match(call('GET', '/rest/api/3/issue/ENG-12/../../myself').error, /may not/);
  assert.match(call('PUT', '/rest/api/3/issue/ENG-12?x=1').error, /may not/);
  assert.match(call('GET', '/rest/api/2/serverInfo').error, /may not/);
  assert.match(readCall('nope').error, /not JSON/);
});

test('makes keys Taro can read', () => {
  const key = connectionKey('https://abc.hello.atlassian-dev.net/x1/t', secret);
  const data = JSON.parse(Buffer.from(key.slice('taro-jira-1.'.length), 'base64url').toString('utf8'));
  assert.deepEqual(data, { u: 'https://abc.hello.atlassian-dev.net/x1/t', s: secret });
});
