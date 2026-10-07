import { Schema, model } from 'mongoose';

/**
 * A URL a workspace asked Taro to send events to. The signing secret is encrypted for this endpoint
 * and shown in full only when it's made or rotated.
 */
export interface WebhookEndpointDoc {
  companyId: string;
  url: string;
  description?: string;
  // Which events it gets: meeting.started, meeting.ended, request.completed
  events: string[];
  enabled: boolean;
  // Taro turned it off after deliveries failed for days in a row
  disabledForFailures?: boolean;
  // Set by the first failed attempt in a run, cleared by the next success
  failingSince?: Date;
  secretEnc: string;
  secretHint: string;
  createdByUserId?: string;
  createdAt: Date;
  updatedAt: Date;
}

const webhookEndpointSchema = new Schema<WebhookEndpointDoc>(
  {
    companyId: { type: String, required: true, ref: 'Company' },
    url: { type: String, required: true },
    description: { type: String },
    events: { type: [String], default: [] },
    enabled: { type: Boolean, default: true },
    disabledForFailures: { type: Boolean },
    failingSince: { type: Date },
    secretEnc: { type: String, required: true, select: false },
    secretHint: { type: String, required: true },
    createdByUserId: { type: String },
  },
  { timestamps: true }
);

webhookEndpointSchema.index({ companyId: 1, enabled: 1 });

export const WebhookEndpointModel = model<WebhookEndpointDoc>('WebhookEndpoint', webhookEndpointSchema);
