import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import path from 'path';
import http from 'http';
import type { AddressInfo } from 'net';
import express from 'express';
import { inboundRouter, presentedSecret, secretMatches } from './inbound';

// From test.env
const SECRET = 'test-inbound-secret-0123456789abcdef';
const fixture = (name: string) => fs.readFileSync(path.join(__dirname, '..', 'services', 'calendar', 'fixtures', name));

let server: http.Server;
let base = '';

before(async () => {
  const app = express();
  app.use('/api/inbound', inboundRouter);
  server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/inbound/email`;
});

after(() => new Promise<void>((resolve) => server.close(() => resolve())));

const basic = (user: string, password: string) => `Basic ${Buffer.from(`${user}:${password}`).toString('base64')}`;

async function post(headers: Record<string, string>, body: Buffer | string) {
  const res = await fetch(base, { method: 'POST', headers, body: typeof body === 'string' ? body : new Uint8Array(body) });
  return { status: res.status, body: await res.json().catch(() => null), challenge: res.headers.get('www-authenticate') };
}

test('without the secret, or with the wrong one, the webhook refuses before reading the mail', async () => {
  const mail = fixture('google-single.eml');
  const none = await post({ 'Content-Type': 'message/rfc822' }, mail);
  assert.equal(none.status, 401);
  assert.equal(none.challenge, 'Basic realm="taro-inbound"');
  assert.equal((await post({ 'Content-Type': 'message/rfc822', 'X-Inbound-Secret': 'guess' }, mail)).status, 401);
  assert.equal((await post({ 'Content-Type': 'message/rfc822', Authorization: basic('taro', `${SECRET}x`) }, mail)).status, 401);
  assert.equal((await post({ 'Content-Type': 'message/rfc822', Authorization: `Bearer ${SECRET}` }, mail)).status, 401);
});

test('mail that is not an invitation gets a 200, so providers do not retry it', async () => {
  const viaHeader = await post({ 'Content-Type': 'message/rfc822', 'X-Inbound-Secret': SECRET }, fixture('newsletter.eml'));
  assert.equal(viaHeader.status, 200);
  assert.deepEqual(viaHeader.body, { ignored: 'no_invitation' });

  // Postmark's shape, authenticated the way its webhook URL carries the secret
  const postmark = await post(
    { 'Content-Type': 'application/json', Authorization: basic('taro', SECRET) },
    JSON.stringify({ FromFull: { Email: 'news@vendor.example' }, OriginalRecipient: 'k3j2h1g0f9e8d7c6b5a4@invite.taro.test', Attachments: [] })
  );
  assert.equal(postmark.status, 200);
  assert.deepEqual(postmark.body, { ignored: 'no_invitation' });

  const garbage = await post({ 'Content-Type': 'application/json', 'X-Inbound-Secret': SECRET }, '{not json');
  assert.equal(garbage.status, 200);
  assert.deepEqual(garbage.body, { ignored: 'unreadable' });
});

test('mail over the size cap is read off and dropped with a 200', async () => {
  const huge = Buffer.alloc(13 * 1024 * 1024, 'a');
  const res = await post({ 'Content-Type': 'message/rfc822', 'X-Inbound-Secret': SECRET }, huge);
  assert.equal(res.status, 200);
  assert.deepEqual(res.body, { ignored: 'too_large' });
});

test('the secret is read from basic auth or the header, and compared whole', () => {
  const req = (headers: Record<string, string>) => ({ header: (name: string) => headers[name.toLowerCase()] }) as never;
  assert.equal(presentedSecret(req({ authorization: basic('anyone', 'pa:ss') })), 'pa:ss');
  assert.equal(presentedSecret(req({ 'x-inbound-secret': ' abc ' })), 'abc');
  assert.equal(presentedSecret(req({ authorization: 'Basic !!!' })), '');
  assert.equal(presentedSecret(req({})), '');
  assert.ok(secretMatches(SECRET, SECRET));
  assert.ok(!secretMatches(SECRET.slice(0, -1), SECRET));
  assert.ok(!secretMatches('', ''));
  assert.ok(!secretMatches(SECRET, ''));
});
