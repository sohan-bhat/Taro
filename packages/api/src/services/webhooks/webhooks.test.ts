import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'http';
import type { AddressInfo } from 'net';
import { isPublicAddress, parseWebhookUrl, resolveWebhookTarget, WebhookUrlError } from './address';
import {
  DISABLE_AFTER_MS,
  makeEvent,
  meetingEndedData,
  nextAttemptAfter,
  plainLinks,
  requestCompletedData,
  shouldDisable,
  signatureHeader,
  verifySignature,
} from './events';
import { sendWebhook } from './send';

test('signs the timestamp and body, and the check rejects anything changed', () => {
  const secret = 'whsec_test';
  const body = '{"id":"evt_1"}';
  const header = signatureHeader(secret, body, 1_700_000_000);
  assert.match(header, /^t=1700000000,v1=[0-9a-f]{64}$/);
  assert.equal(verifySignature(secret, body, header, 1_700_000_100), true);
  assert.equal(verifySignature(secret, `${body} `, header, 1_700_000_100), false);
  assert.equal(verifySignature('whsec_other', body, header, 1_700_000_100), false);
  // Too old to trust: a replay
  assert.equal(verifySignature(secret, body, header, 1_700_000_000 + 301), false);
  assert.equal(verifySignature(secret, body, 'garbage', 1_700_000_000), false);
});

test('only public addresses pass', () => {
  for (const address of ['8.8.8.8', '1.1.1.1', '2606:4700:4700::1111', '100.63.255.255', '172.32.0.1']) {
    assert.equal(isPublicAddress(address), true, address);
  }
  for (const address of [
    '127.0.0.1',
    '10.1.2.3',
    '172.16.0.1',
    '192.168.1.1',
    '169.254.169.254',
    '100.64.0.1',
    '0.0.0.0',
    '224.0.0.1',
    '255.255.255.255',
    '::1',
    '::',
    'fd00:ec2::254',
    'fe80::1',
    '::ffff:127.0.0.1',
    '::ffff:7f00:1',
    '64:ff9b::a9fe:a9fe',
    'not an address',
  ]) {
    assert.equal(isPublicAddress(address), false, address);
  }
});

test('URLs must be https, without credentials, unless local ones are allowed', () => {
  assert.throws(() => parseWebhookUrl('http://example.com/hook', { allowLocal: false }), WebhookUrlError);
  assert.throws(() => parseWebhookUrl('https://user:pass@example.com/hook', { allowLocal: false }), WebhookUrlError);
  assert.throws(() => parseWebhookUrl('ftp://example.com', { allowLocal: false }), WebhookUrlError);
  assert.throws(() => parseWebhookUrl('not a url', { allowLocal: false }), WebhookUrlError);
  assert.throws(() => parseWebhookUrl('http://localhost:3000/hook', { allowLocal: false }), WebhookUrlError);
  assert.equal(parseWebhookUrl('http://localhost:3000/hook', { allowLocal: true }).hostname, 'localhost');
  assert.equal(parseWebhookUrl(' https://example.com/hook#x ', { allowLocal: false }).toString(), 'https://example.com/hook');
});

test('a name with any private answer is refused, and the checked address is the one used', async () => {
  const lookup = (answers: string[]) => async () => answers.map((address) => ({ address, family: address.includes(':') ? 6 : 4 }));
  const ok = await resolveWebhookTarget('https://hooks.example.com/x', { allowLocal: false, lookup: lookup(['93.184.216.34']) });
  assert.equal(ok.address, '93.184.216.34');
  await assert.rejects(
    resolveWebhookTarget('https://hooks.example.com/x', { allowLocal: false, lookup: lookup(['93.184.216.34', '10.0.0.5']) }),
    WebhookUrlError
  );
  await assert.rejects(resolveWebhookTarget('https://169.254.169.254/latest', { allowLocal: false }), WebhookUrlError);
  await assert.rejects(resolveWebhookTarget('https://[::1]/x', { allowLocal: false }), WebhookUrlError);
  await assert.rejects(
    resolveWebhookTarget('https://nowhere.example/x', {
      allowLocal: false,
      lookup: async () => {
        throw new Error('ENOTFOUND');
      },
    }),
    /Couldn't find/
  );
});

test('retries at 30 seconds, 5 minutes, 30 minutes, and 2 hours, then stops', () => {
  const now = 1_000_000;
  assert.deepEqual(
    [1, 2, 3, 4].map((n) => nextAttemptAfter(n, now)!.getTime() - now),
    [30_000, 300_000, 1_800_000, 7_200_000]
  );
  assert.equal(nextAttemptAfter(5, now), null);
});

test('turns an endpoint off only after three days of failures in a row', () => {
  const now = Date.now();
  assert.equal(shouldDisable(undefined, now), false);
  assert.equal(shouldDisable(new Date(now - DISABLE_AFTER_MS + 1000), now), false);
  assert.equal(shouldDisable(new Date(now - DISABLE_AFTER_MS), now), true);
});

test('event bodies: Slack links written out, links pulled from results, transcripts capped', () => {
  const event = makeEvent('webhook.test', 'w1', { a: 1 }, new Date('2026-10-07T12:00:00Z'));
  assert.match(event.id, /^evt_/);
  assert.equal(event.createdAt, '2026-10-07T12:00:00.000Z');
  assert.equal(event.workspaceId, 'w1');

  assert.equal(plainLinks('Opened issue <https://github.com/a/b/issues/12|#12> in a/b.'), 'Opened issue #12 (https://github.com/a/b/issues/12) in a/b.');

  const done = requestCompletedData('m1', {
    command: 'file an issue about the export',
    intent: { action: 'create_github_issue', params: { title: 'Export times out', original: 'raw' } },
    outcome: 'done',
    summary: 'Opened issue <https://github.com/a/b/issues/12|#12> in a/b.',
    result: 'Opened issue #12 in a/b: https://github.com/a/b/issues/12',
  });
  assert.equal(done.meetingId, 'm1');
  assert.equal(done.request.url, 'https://github.com/a/b/issues/12');
  assert.equal(done.request.summary, 'Opened issue #12 (https://github.com/a/b/issues/12) in a/b.');
  assert.deepEqual(done.request.params, { title: 'Export times out' });

  // Older logs only have status; a refusal has no link even when a result mentions one
  const old = requestCompletedData('m1', { command: 'x', status: 'failed', result: 'see https://example.com' });
  assert.equal(old.request.outcome, 'failed');
  assert.equal(old.request.url, null);

  const meeting = {
    _id: 'm1',
    meetUrl: 'https://meet.google.com/abc-defg-hij',
    platform: 'google_meet',
    status: 'ended',
    startedAt: new Date('2026-10-07T12:00:00Z'),
    endedAt: new Date('2026-10-07T12:30:00Z'),
    liveTranscript: 'x'.repeat(200_001),
  };
  const ended = meetingEndedData(meeting, [{ command: 'post hi to general', outcome: 'done', summary: 'Posted in #general.' }], [
    'Posted in #general.',
  ]);
  assert.equal(ended.meeting.id, 'm1');
  assert.equal(ended.meeting.title, null);
  assert.equal(ended.meeting.startedAt, '2026-10-07T12:00:00.000Z');
  assert.equal(ended.requests.length, 1);
  assert.equal(ended.transcript?.length, 200_000);
  assert.equal(ended.transcriptTruncated, true);
});

/** A local receiver for sendWebhook, which allows http://localhost outside production. */
async function receiver(t: import('node:test').TestContext, handle: http.RequestListener) {
  const server = http.createServer(handle);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise<void>((resolve) => server.close(() => resolve())));
  return `http://localhost:${(server.address() as AddressInfo).port}`;
}

test('sends signed JSON and counts a 2xx as delivered', async (t) => {
  let seen: { headers: http.IncomingHttpHeaders; body: string } | null = null;
  const base = await receiver(t, (req, res) => {
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => {
      seen = { headers: req.headers, body };
      res.writeHead(204).end();
    });
  });
  const body = JSON.stringify({ id: 'evt_1' });
  const now = Math.floor(Date.now() / 1000);
  const result = await sendWebhook(`${base}/hook`, body, {
    'Content-Type': 'application/json',
    'Taro-Signature': signatureHeader('whsec_x', body, now),
  });
  assert.equal(result.ok, true);
  assert.equal(result.statusCode, 204);
  assert.ok(seen);
  const got = seen as { headers: http.IncomingHttpHeaders; body: string };
  assert.equal(got.body, body);
  assert.equal(verifySignature('whsec_x', got.body, String(got.headers['taro-signature']), now), true);
});

test('a redirect is a failure, never followed', async (t) => {
  let hits = 0;
  const base = await receiver(t, (req, res) => {
    hits += 1;
    res.writeHead(302, { Location: 'http://169.254.169.254/latest/meta-data' }).end();
  });
  const result = await sendWebhook(`${base}/hook`, '{}', {});
  assert.equal(result.ok, false);
  assert.equal(result.statusCode, 302);
  assert.match(result.error ?? '', /doesn't follow redirects/);
  assert.equal(hits, 1);
});

test('a 500 is a failure with the reply kept short', async (t) => {
  const base = await receiver(t, (_req, res) => res.writeHead(500).end('x'.repeat(5000)));
  const result = await sendWebhook(`${base}/hook`, '{}', {});
  assert.equal(result.ok, false);
  assert.equal(result.statusCode, 500);
  assert.ok((result.error ?? '').length <= 300);
});
