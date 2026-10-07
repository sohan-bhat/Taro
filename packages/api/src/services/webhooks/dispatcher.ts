/**
 * Queues events for a workspace's webhook endpoints and sends them. Every event is saved as one
 * delivery per endpoint before anything is sent, so a restart picks up where it left off. The worker
 * leases each delivery while it sends, so two servers never send the same one, and retries failures
 * on RETRY_DELAYS_MS. Emitting never throws and never waits on the network: meetings don't slow
 * down because a receiver is slow or down.
 */

import type { WebhookDelivery, WebhookEndpoint, WebhookEventType } from '@taro/shared';
import { ActionLogModel, MeetingModel, WebhookDeliveryModel, WebhookEndpointModel } from '../../db/models';
import type { WebhookDeliveryDoc } from '../../db/models/WebhookDelivery';
import type { WebhookEndpointDoc } from '../../db/models/WebhookEndpoint';
import { mongoose } from '../../db/mongo';
import { decryptSecret } from '../../lib/crypto';
import { log, errorMessage } from '../../lib/logger';
import {
  makeEvent,
  meetingEndedData,
  meetingStartedData,
  nextAttemptAfter,
  shouldDisable,
  signatureHeader,
  type MeetingFields,
} from './events';
import { sendWebhook, type SendResult } from './send';

const KEEP_PER_ENDPOINT = 50;
const KEEP_DAYS = 14;
const LEASE_MS = 30_000;
const BATCH = 20;

export const secretContext = (endpointId: string) => `webhook:${endpointId}:secret`;

const expiry = (now: number) => new Date(now + KEEP_DAYS * 24 * 60 * 60_000);

/** Queues an event for every enabled endpoint in the workspace that wants it. Never throws. */
export async function emitWebhookEvent(companyId: string, type: WebhookEventType, data: Record<string, unknown>): Promise<void> {
  // Without a database there's nowhere to queue it (tests, or a server still starting)
  if (mongoose.connection.readyState !== 1) return;
  try {
    const endpoints = await WebhookEndpointModel.find({ companyId, enabled: true, events: type }).select('_id').lean();
    if (endpoints.length === 0) return;
    const event = makeEvent(type, companyId, data);
    const body = JSON.stringify(event);
    const now = Date.now();
    await WebhookDeliveryModel.insertMany(
      endpoints.map((e) => ({
        companyId,
        endpointId: String(e._id),
        eventId: event.id,
        type,
        body,
        status: 'pending',
        attempts: 0,
        nextAttemptAt: new Date(now),
        expiresAt: expiry(now),
      }))
    );
    kick();
  } catch (error) {
    log.warn(`[Webhooks] Couldn't queue ${type} for workspace ${companyId}: ${errorMessage(error)}`);
  }
}

// Each meeting sends meeting.started and meeting.ended once, however many times its audio reconnects
// or however it ends. The claim is a write, so it's only made when someone is listening.
async function claimMeetingEvent(meetingId: string, companyId: string, type: WebhookEventType) {
  if (mongoose.connection.readyState !== 1) return null;
  const listening = await WebhookEndpointModel.exists({ companyId, enabled: true, events: type });
  if (!listening) return null;
  return MeetingModel.findOneAndUpdate(
    { _id: meetingId, webhookEvents: { $ne: type } },
    { $addToSet: { webhookEvents: type } },
    { new: true }
  ).lean<MeetingFields & { companyId: string }>();
}

export function emitMeetingStarted(meetingId: string, companyId: string): void {
  claimMeetingEvent(meetingId, companyId, 'meeting.started')
    .then((meeting) => meeting && emitWebhookEvent(companyId, 'meeting.started', meetingStartedData(meeting)))
    .catch((error) => log.warn(`[Webhooks] meeting.started for ${meetingId}: ${errorMessage(error)}`));
}

/** `recap` is the lines Taro posted, when the end of the call produced them. */
export function emitMeetingEnded(meetingId: string, companyId: string, recap: readonly string[] = []): void {
  (async () => {
    const meeting = await claimMeetingEvent(meetingId, companyId, 'meeting.ended');
    if (!meeting) return;
    const requests = await ActionLogModel.find({ meetingId }).sort({ createdAt: 1 }).lean();
    await emitWebhookEvent(companyId, 'meeting.ended', meetingEndedData(meeting, requests, recap));
  })().catch((error) => log.warn(`[Webhooks] meeting.ended for ${meetingId}: ${errorMessage(error)}`));
}

// ---------------------------------------------------------------------------------------------
// Sending

let running = false;
let again = false;

/** Sends what's due now. Runs on a timer, and right after an event is queued. */
export async function webhookTick(): Promise<void> {
  if (running) {
    again = true;
    return;
  }
  running = true;
  try {
    do {
      again = false;
      const claimed: WebhookDeliveryDoc[] = [];
      for (let i = 0; i < BATCH; i++) {
        const next = await claimDue(Date.now());
        if (!next) break;
        claimed.push(next);
      }
      await Promise.all(
        claimed.map((d) =>
          attempt(d as WebhookDeliveryDoc & { _id: unknown }).catch((error) => log.warn(`[Webhooks] Delivery failed to run: ${errorMessage(error)}`))
        )
      );
      if (claimed.length === BATCH) again = true;
    } while (again);
  } finally {
    running = false;
  }
}

function kick() {
  setImmediate(() => {
    webhookTick().catch((error) => log.warn(`[Webhooks] Tick failed: ${errorMessage(error)}`));
  });
}

function claimDue(now: number) {
  return WebhookDeliveryModel.findOneAndUpdate(
    {
      status: 'pending',
      once: { $ne: true },
      nextAttemptAt: { $lte: new Date(now) },
      $or: [{ leaseUntil: { $exists: false } }, { leaseUntil: { $lt: new Date(now) } }],
    },
    { $set: { leaseUntil: new Date(now + LEASE_MS) } },
    { sort: { nextAttemptAt: 1 }, new: true }
  ).lean<WebhookDeliveryDoc>();
}

function headersFor(delivery: { _id: unknown; type: string }, secret: string, body: string, now: number) {
  return {
    'Content-Type': 'application/json',
    'User-Agent': 'Taro-Webhooks/1',
    'Taro-Event': delivery.type,
    'Taro-Delivery': String(delivery._id),
    'Taro-Signature': signatureHeader(secret, body, Math.floor(now / 1000)),
  };
}

/** One try at one delivery that this server holds the lease on. Records how it went. */
export async function attempt(delivery: WebhookDeliveryDoc & { _id: unknown }): Promise<SendResult | null> {
  const endpoint = await WebhookEndpointModel.findById(delivery.endpointId).select('+secretEnc').lean<WebhookEndpointDoc & { _id: unknown }>();
  const attempts = delivery.attempts + 1;
  if (!endpoint || !endpoint.enabled) {
    await WebhookDeliveryModel.updateOne(
      { _id: delivery._id },
      { $set: { status: 'failed', error: endpoint ? 'The endpoint is turned off.' : 'The endpoint was deleted.' }, $unset: { leaseUntil: 1, nextAttemptAt: 1 } }
    );
    return null;
  }

  const now = Date.now();
  const secret = decryptSecret(endpoint.secretEnc, secretContext(String(endpoint._id)));
  const result = await sendWebhook(endpoint.url, delivery.body, headersFor(delivery, secret, delivery.body, now));
  const done = Date.now();

  if (result.ok) {
    await WebhookDeliveryModel.updateOne(
      { _id: delivery._id },
      {
        $set: { status: 'delivered', attempts, statusCode: result.statusCode, durationMs: result.durationMs, deliveredAt: new Date(done) },
        $unset: { leaseUntil: 1, nextAttemptAt: 1, error: 1 },
      }
    );
    if (endpoint.failingSince) await WebhookEndpointModel.updateOne({ _id: endpoint._id }, { $unset: { failingSince: 1 } });
  } else {
    const next = delivery.once ? null : nextAttemptAfter(attempts, done);
    await WebhookDeliveryModel.updateOne(
      { _id: delivery._id },
      {
        $set: {
          status: next ? 'pending' : 'failed',
          attempts,
          error: result.error,
          durationMs: result.durationMs,
          ...(result.statusCode ? { statusCode: result.statusCode } : {}),
          ...(next ? { nextAttemptAt: next } : {}),
        },
        $unset: { leaseUntil: 1, ...(next ? {} : { nextAttemptAt: 1 }), ...(result.statusCode ? {} : { statusCode: 1 }) },
      }
    );
    // Tests don't count against an endpoint: someone is looking at the result right then
    if (!delivery.once) await recordFailure(endpoint, done);
  }
  await prune(delivery.endpointId);
  return result;
}

async function recordFailure(endpoint: WebhookEndpointDoc & { _id: unknown }, now: number) {
  if (!endpoint.failingSince) {
    await WebhookEndpointModel.updateOne({ _id: endpoint._id, failingSince: { $exists: false } }, { $set: { failingSince: new Date(now) } });
    return;
  }
  if (!shouldDisable(endpoint.failingSince, now)) return;
  const off = await WebhookEndpointModel.updateOne({ _id: endpoint._id, enabled: true }, { $set: { enabled: false, disabledForFailures: true } });
  if (off.modifiedCount > 0) {
    log.warn(`[Webhooks] Turned off endpoint ${String(endpoint._id)} in workspace ${endpoint.companyId}: failing for 3 days`);
    await WebhookDeliveryModel.updateMany(
      { endpointId: String(endpoint._id), status: 'pending' },
      { $set: { status: 'failed', error: 'The endpoint was turned off after failing for 3 days.' }, $unset: { nextAttemptAt: 1, leaseUntil: 1 } }
    );
  }
}

/** Keeps the newest KEEP_PER_ENDPOINT finished deliveries for an endpoint. Ones still trying stay. */
async function prune(endpointId: string) {
  const old = (await WebhookDeliveryModel.find({ endpointId }).sort({ createdAt: -1 }).select('_id').lean()).slice(KEEP_PER_ENDPOINT);
  if (old.length > 0) await WebhookDeliveryModel.deleteMany({ _id: { $in: old.map((d) => d._id) }, status: { $ne: 'pending' } });
}

/** Sends a webhook.test to one endpoint right away, once, and answers with how it went. */
export async function sendTest(endpoint: { _id: unknown; companyId: string }, data: Record<string, unknown>): Promise<WebhookDelivery> {
  const event = makeEvent('webhook.test', endpoint.companyId, data);
  const now = Date.now();
  const created = await WebhookDeliveryModel.create({
    companyId: endpoint.companyId,
    endpointId: String(endpoint._id),
    eventId: event.id,
    type: event.type,
    body: JSON.stringify(event),
    status: 'pending',
    attempts: 0,
    once: true,
    leaseUntil: new Date(now + LEASE_MS),
    expiresAt: expiry(now),
  });
  await attempt(created.toObject() as WebhookDeliveryDoc & { _id: unknown });
  const after = await WebhookDeliveryModel.findById(created._id).lean<WebhookDeliveryDoc & { _id: unknown }>();
  return deliveryView(after ?? (created.toObject() as WebhookDeliveryDoc & { _id: unknown }));
}

// ---------------------------------------------------------------------------------------------
// What the dashboard sees

export function endpointView(e: WebhookEndpointDoc & { _id: unknown }): WebhookEndpoint {
  return {
    _id: String(e._id),
    url: e.url,
    ...(e.description ? { description: e.description } : {}),
    events: e.events,
    enabled: e.enabled,
    ...(e.disabledForFailures ? { disabledForFailures: true } : {}),
    ...(e.failingSince ? { failingSince: e.failingSince.toISOString() } : {}),
    secretHint: e.secretHint,
    createdAt: e.createdAt.toISOString(),
  };
}

export function deliveryView(d: WebhookDeliveryDoc & { _id: unknown }): WebhookDelivery {
  return {
    _id: String(d._id),
    eventId: d.eventId,
    type: d.type as WebhookDelivery['type'],
    status: d.status,
    attempts: d.attempts,
    ...(d.statusCode ? { statusCode: d.statusCode } : {}),
    ...(d.error ? { error: d.error } : {}),
    ...(d.durationMs !== undefined ? { durationMs: d.durationMs } : {}),
    ...(d.status === 'pending' && d.nextAttemptAt ? { nextAttemptAt: d.nextAttemptAt.toISOString() } : {}),
    createdAt: d.createdAt.toISOString(),
    ...(d.deliveredAt ? { deliveredAt: d.deliveredAt.toISOString() } : {}),
  };
}
