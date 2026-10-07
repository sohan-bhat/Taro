import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'http';
import type { AddressInfo } from 'net';
import { WebhookDeliveryModel, WebhookEndpointModel } from '../../db/models';
import type { WebhookDeliveryDoc } from '../../db/models/WebhookDelivery';
import { encryptSecret } from '../../lib/crypto';
import { memoryModel, useMemory } from '../../lib/testing/memoryModel';
import { attempt, secretContext } from './dispatcher';
import { DISABLE_AFTER_MS, verifySignature } from './events';

/** A receiver answering with `status`, and the in-memory endpoint and deliveries pointing at it. */
async function setup(t: import('node:test').TestContext, status: number, endpoint: Record<string, unknown> = {}) {
  const seen: http.IncomingHttpHeaders[] = [];
  const server = http.createServer((req, res) => {
    seen.push(req.headers);
    req.resume().on('end', () => res.writeHead(status).end());
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise<void>((resolve) => server.close(() => resolve())));

  const endpoints = useMemory(t, WebhookEndpointModel, memoryModel());
  const deliveries = useMemory(t, WebhookDeliveryModel, memoryModel());
  const e = await endpoints.create({
    companyId: 'w1',
    url: `http://localhost:${(server.address() as AddressInfo).port}/hook`,
    events: ['request.completed'],
    enabled: true,
    secretHint: 'whse…cret',
    ...endpoint,
  });
  const stored = endpoints.docs.find((d) => d._id === e._id)!;
  stored.secretEnc = encryptSecret('whsec_secret', secretContext(e._id));

  const add = async (fields: Partial<WebhookDeliveryDoc> = {}) =>
    (await deliveries.create({
      companyId: 'w1',
      endpointId: e._id,
      eventId: 'evt_1',
      type: 'request.completed',
      body: '{"id":"evt_1"}',
      status: 'pending',
      attempts: 0,
      nextAttemptAt: new Date(),
      createdAt: new Date(),
      expiresAt: new Date(Date.now() + 86_400_000),
      ...fields,
    })) as unknown as WebhookDeliveryDoc & { _id: string };
  const delivery = (id: string) => deliveries.docs.find((d) => d._id === id)!;
  return { seen, endpoint: stored, add, delivery };
}

test('a delivered event is signed, recorded, and clears a run of failures', async (t) => {
  const { seen, endpoint, add, delivery } = await setup(t, 200, { failingSince: new Date(Date.now() - 60_000) });
  const d = await add();
  const result = await attempt(d);
  assert.equal(result?.ok, true);
  assert.equal(delivery(d._id).status, 'delivered');
  assert.equal(delivery(d._id).attempts, 1);
  assert.equal(seen[0]['taro-event'], 'request.completed');
  assert.equal(seen[0]['taro-delivery'], d._id);
  assert.equal(seen[0]['user-agent'], 'Taro-Webhooks/1');
  assert.ok(verifySignature('whsec_secret', '{"id":"evt_1"}', String(seen[0]['taro-signature']), Math.floor(Date.now() / 1000)));
  assert.equal(endpoint.failingSince, undefined);
});

test('a failure is tried again later, and the fifth failure is final', async (t) => {
  const { endpoint, add, delivery } = await setup(t, 500);
  const first = await add();
  const before = Date.now();
  await attempt(first);
  const after = delivery(first._id);
  assert.equal(after.status, 'pending');
  assert.equal(after.attempts, 1);
  assert.equal(after.statusCode, 500);
  const wait = (after.nextAttemptAt as Date).getTime() - before;
  assert.ok(wait >= 30_000 && wait < 31_000, String(wait));
  assert.ok(endpoint.failingSince instanceof Date);

  const last = await add({ attempts: 4 });
  await attempt(last);
  assert.equal(delivery(last._id).status, 'failed');
  assert.equal(delivery(last._id).nextAttemptAt, undefined);
});

test('three days of failures turn the endpoint off and stop what was waiting', async (t) => {
  const { endpoint, add, delivery } = await setup(t, 500, { failingSince: new Date(Date.now() - DISABLE_AFTER_MS - 1000) });
  const waiting = await add({ nextAttemptAt: new Date(Date.now() + 60_000) });
  await attempt(await add());
  assert.equal(endpoint.enabled, false);
  assert.equal(endpoint.disabledForFailures, true);
  assert.equal(delivery(waiting._id).status, 'failed');
});

test('a test that fails is not retried and does not count against the endpoint', async (t) => {
  const { endpoint, add, delivery } = await setup(t, 500);
  const d = await add({ once: true, type: 'webhook.test' });
  await attempt(d);
  assert.equal(delivery(d._id).status, 'failed');
  assert.equal(endpoint.failingSince, undefined);
});

test('an endpoint that was turned off gets nothing', async (t) => {
  const { seen, add, delivery } = await setup(t, 200, { enabled: false });
  const d = await add();
  assert.equal(await attempt(d), null);
  assert.equal(delivery(d._id).status, 'failed');
  assert.equal(seen.length, 0);
});
