/**
 * The workspace's own webhook endpoints: where Taro sends meeting events. Owners and admins only;
 * the URLs and deliveries carry meeting content, so members don't see them. A signing secret is
 * returned in full only by create and rotate.
 */

import { Router, type Router as RouterType } from 'express';
import { isValidObjectId } from 'mongoose';
import { MAX_WEBHOOK_ENDPOINTS, WEBHOOK_EVENT_TYPES } from '@taro/shared';
import { WebhookDeliveryModel, WebhookEndpointModel } from '../db/models';
import type { WebhookDeliveryDoc } from '../db/models/WebhookDelivery';
import type { WebhookEndpointDoc } from '../db/models/WebhookEndpoint';
import { asyncHandler } from '../middleware/errorHandler';
import { requireAdmin, requireAuth, type AuthedRequest } from '../middleware/auth';
import { NotFoundError, ValidationError } from '../lib/errors';
import { encryptSecret, keyHint } from '../lib/crypto';
import { resolveWebhookTarget, WebhookUrlError } from '../services/webhooks/address';
import { deliveryView, endpointView, secretContext, sendTest } from '../services/webhooks/dispatcher';
import { newSecret, testData } from '../services/webhooks/events';
import { allowLocalWebhooks } from '../services/webhooks/send';

export const outgoingWebhooksRouter: RouterType = Router();
outgoingWebhooksRouter.use(requireAuth, requireAdmin);

type EndpointLean = WebhookEndpointDoc & { _id: unknown };

async function checkedUrl(raw: unknown): Promise<string> {
  try {
    return (await resolveWebhookTarget(raw, { allowLocal: allowLocalWebhooks() })).url.toString();
  } catch (error) {
    if (error instanceof WebhookUrlError) throw new ValidationError(error.message);
    throw error;
  }
}

function events(raw: unknown): string[] {
  if (raw === undefined) return [...WEBHOOK_EVENT_TYPES];
  if (!Array.isArray(raw)) throw new ValidationError('events must be a list.');
  const picked = [...new Set(raw.filter((e): e is string => typeof e === 'string' && WEBHOOK_EVENT_TYPES.includes(e)))];
  if (picked.length === 0) throw new ValidationError('Choose at least one event to send.');
  return picked;
}

function description(raw: unknown): string | undefined {
  if (raw === undefined || raw === null) return undefined;
  if (typeof raw !== 'string') throw new ValidationError('description must be text.');
  return raw.trim().slice(0, 120) || undefined;
}

async function mine(req: AuthedRequest): Promise<EndpointLean> {
  const id = req.params.id;
  const endpoint = isValidObjectId(id) ? await WebhookEndpointModel.findOne({ _id: id, companyId: req.companyId }).lean<EndpointLean>() : null;
  if (!endpoint) throw new NotFoundError('Webhook endpoint');
  return endpoint;
}

outgoingWebhooksRouter.get(
  '/',
  asyncHandler(async (req: AuthedRequest, res) => {
    const endpoints = await WebhookEndpointModel.find({ companyId: req.companyId }).sort({ createdAt: 1 }).lean<EndpointLean[]>();
    res.json({ endpoints: endpoints.map(endpointView) });
  })
);

outgoingWebhooksRouter.post(
  '/',
  asyncHandler(async (req: AuthedRequest, res) => {
    const body = req.body ?? {};
    const count = await WebhookEndpointModel.countDocuments({ companyId: req.companyId });
    if (count >= MAX_WEBHOOK_ENDPOINTS) {
      throw new ValidationError(`A workspace can have ${MAX_WEBHOOK_ENDPOINTS} endpoints. Delete one to add another.`);
    }
    const url = await checkedUrl(body.url);
    const secret = newSecret();
    const endpoint = new WebhookEndpointModel({
      companyId: req.companyId,
      url,
      description: description(body.description),
      events: events(body.events),
      enabled: true,
      secretHint: keyHint(secret),
      createdByUserId: req.userId,
    });
    // The secret is bound to the endpoint's own ID, so it can't be copied onto another one
    endpoint.secretEnc = encryptSecret(secret, secretContext(String(endpoint._id)));
    await endpoint.save();
    res.status(201).json({ endpoint: endpointView(endpoint.toObject() as EndpointLean), secret });
  })
);

outgoingWebhooksRouter.patch(
  '/:id',
  asyncHandler(async (req: AuthedRequest, res) => {
    const endpoint = await mine(req);
    const body = req.body ?? {};
    const set: Record<string, unknown> = {};
    const unset: Record<string, 1> = {};
    if (body.url !== undefined) set.url = await checkedUrl(body.url);
    if (body.description !== undefined) {
      const d = description(body.description);
      if (d) set.description = d;
      else unset.description = 1;
    }
    if (body.events !== undefined) set.events = events(body.events);
    if (body.enabled !== undefined) {
      if (typeof body.enabled !== 'boolean') throw new ValidationError('enabled must be true or false.');
      set.enabled = body.enabled;
      // Turning it back on starts a fresh count of failures
      if (body.enabled) Object.assign(unset, { disabledForFailures: 1, failingSince: 1 });
    }
    const updated = await WebhookEndpointModel.findOneAndUpdate(
      { _id: endpoint._id, companyId: req.companyId },
      { ...(Object.keys(set).length ? { $set: set } : {}), ...(Object.keys(unset).length ? { $unset: unset } : {}) },
      { new: true }
    ).lean<EndpointLean>();
    if (!updated) throw new NotFoundError('Webhook endpoint');
    res.json({ endpoint: endpointView(updated) });
  })
);

outgoingWebhooksRouter.delete(
  '/:id',
  asyncHandler(async (req: AuthedRequest, res) => {
    const endpoint = await mine(req);
    await WebhookEndpointModel.deleteOne({ _id: endpoint._id, companyId: req.companyId });
    await WebhookDeliveryModel.deleteMany({ endpointId: String(endpoint._id) });
    res.json({ deleted: true });
  })
);

outgoingWebhooksRouter.post(
  '/:id/rotate',
  asyncHandler(async (req: AuthedRequest, res) => {
    const endpoint = await mine(req);
    const secret = newSecret();
    const updated = await WebhookEndpointModel.findOneAndUpdate(
      { _id: endpoint._id, companyId: req.companyId },
      { $set: { secretEnc: encryptSecret(secret, secretContext(String(endpoint._id))), secretHint: keyHint(secret) } },
      { new: true }
    ).lean<EndpointLean>();
    if (!updated) throw new NotFoundError('Webhook endpoint');
    res.json({ endpoint: endpointView(updated), secret });
  })
);

outgoingWebhooksRouter.post(
  '/:id/test',
  asyncHandler(async (req: AuthedRequest, res) => {
    const endpoint = await mine(req);
    res.json({ delivery: await sendTest(endpoint, testData(String(endpoint._id))) });
  })
);

outgoingWebhooksRouter.get(
  '/:id/deliveries',
  asyncHandler(async (req: AuthedRequest, res) => {
    const endpoint = await mine(req);
    const deliveries = await WebhookDeliveryModel.find({ endpointId: String(endpoint._id) })
      .sort({ createdAt: -1 })
      .limit(50)
      .select('-body')
      .lean<Array<WebhookDeliveryDoc & { _id: unknown }>>();
    res.json({ deliveries: deliveries.map(deliveryView) });
  })
);
