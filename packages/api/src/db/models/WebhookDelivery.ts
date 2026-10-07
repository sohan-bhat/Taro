import { Schema, model } from 'mongoose';

export type DeliveryStatus = 'pending' | 'delivered' | 'failed';

/**
 * One event on its way to one endpoint, kept so a restart doesn't lose it and so the dashboard can
 * show what happened. The body is fixed when the event happens; each attempt signs it afresh.
 */
export interface WebhookDeliveryDoc {
  companyId: string;
  endpointId: string;
  eventId: string;
  type: string;
  body: string;
  status: DeliveryStatus;
  attempts: number;
  // A test is tried once, while the person who sent it waits
  once?: boolean;
  nextAttemptAt?: Date;
  // A server sending it holds it until then, so another server doesn't send it too
  leaseUntil?: Date;
  statusCode?: number;
  error?: string;
  durationMs?: number;
  deliveredAt?: Date;
  expiresAt: Date;
  createdAt: Date;
  updatedAt: Date;
}

const webhookDeliverySchema = new Schema<WebhookDeliveryDoc>(
  {
    companyId: { type: String, required: true },
    endpointId: { type: String, required: true, ref: 'WebhookEndpoint' },
    eventId: { type: String, required: true },
    type: { type: String, required: true },
    body: { type: String, required: true },
    status: { type: String, enum: ['pending', 'delivered', 'failed'], default: 'pending' },
    attempts: { type: Number, default: 0 },
    once: { type: Boolean },
    nextAttemptAt: { type: Date },
    leaseUntil: { type: Date },
    statusCode: { type: Number },
    error: { type: String },
    durationMs: { type: Number },
    deliveredAt: { type: Date },
    expiresAt: { type: Date, required: true },
  },
  { timestamps: true }
);

webhookDeliverySchema.index({ status: 1, nextAttemptAt: 1 });
webhookDeliverySchema.index({ endpointId: 1, createdAt: -1 });
webhookDeliverySchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

export const WebhookDeliveryModel = model<WebhookDeliveryDoc>('WebhookDelivery', webhookDeliverySchema);
