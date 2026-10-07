import { Schema, model } from 'mongoose';
import type { TrackerSpace } from '@taro/shared';

/**
 * Linear, installed as the Taro app (OAuth with actor=app): tickets and comments come from the app,
 * never from the person who installed it. Tokens are encrypted; access tokens last a day and are
 * refreshed with the refresh token.
 */
export interface LinearConnectionDoc {
  companyId: string;
  organizationId: string;
  organizationName?: string;
  // linear.app/<urlKey>
  urlKey?: string;
  accessTokenEnc: string;
  refreshTokenEnc?: string;
  accessExpiresAt?: Date;
  teams: TrackerSpace[];
  defaultTeamId?: string;
  // Subset of TICKET_CAPABILITIES; unset means DEFAULT_TICKET_ACTIONS
  enabledActions?: string[];
  // Linear refused the token and refreshing failed; nothing works until someone connects again
  needsReconnect?: boolean;
  connectedByUserId?: string;
  createdAt: Date;
  updatedAt: Date;
}

const spaceSchema = new Schema<TrackerSpace>(
  { id: { type: String, required: true }, key: { type: String, required: true }, name: { type: String, required: true } },
  { _id: false }
);

const linearConnectionSchema = new Schema<LinearConnectionDoc>(
  {
    companyId: { type: String, required: true, unique: true, ref: 'Company' },
    organizationId: { type: String, required: true },
    organizationName: { type: String },
    urlKey: { type: String },
    accessTokenEnc: { type: String, required: true },
    refreshTokenEnc: { type: String },
    accessExpiresAt: { type: Date },
    teams: { type: [spaceSchema], default: [] },
    defaultTeamId: { type: String },
    enabledActions: { type: [String], default: undefined },
    needsReconnect: { type: Boolean },
    connectedByUserId: { type: String },
  },
  { timestamps: true }
);

export const LinearConnectionModel = model<LinearConnectionDoc>('LinearConnection', linearConnectionSchema);

/**
 * Linear's answer, parked between the callback and the dashboard. Only the session of the person
 * who started connecting can redeem it, so a link finished in someone else's browser connects nothing.
 */
export interface LinearGrantDoc {
  tokenHash: string;
  companyId: string;
  userId: string;
  // The token response, encrypted
  payloadEnc: string;
  expiresAt: Date;
}

const linearGrantSchema = new Schema<LinearGrantDoc>({
  tokenHash: { type: String, required: true, unique: true },
  companyId: { type: String, required: true },
  userId: { type: String, required: true },
  payloadEnc: { type: String, required: true },
  expiresAt: { type: Date, required: true },
});
linearGrantSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

export const LinearGrantModel = model<LinearGrantDoc>('LinearGrant', linearGrantSchema);
