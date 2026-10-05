import { Schema, model } from 'mongoose';
import type { GoogleCalendarJoinMode } from '@taro/shared';

// reconnect: Google refused the grant (revoked, or expired), so nothing syncs until the person connects again.
export type GoogleCalendarConnectionStatus = 'active' | 'reconnect';

/** The push channel Google notifies when the calendar changes. */
export interface GoogleCalendarChannel {
  id: string;
  // Hash of the token Google echoes with each notification
  tokenHash: string;
  resourceId: string;
  expiresAt: Date;
  // Google's first message arrived, so notifications reach Taro and polling can slow down
  confirmedAt?: Date;
}

/**
 * One member's connected Google Calendar. Taro reads their primary calendar to find the meetings to
 * join and never changes it. The refresh token is kept encrypted and bound to the member; access
 * tokens live only in memory. The events themselves are never stored here: the ones Taro joins become
 * calendar occurrences, and the rest are read and dropped.
 */
export interface GoogleCalendarConnectionDoc {
  companyId: string;
  userId: string;
  // The Google account it reads: its address, shown in Setup, and its stable ID
  email: string;
  googleSub: string;
  refreshTokenEnc?: string;
  status: GoogleCalendarConnectionStatus;
  // "Join my meetings automatically", and which ones
  autoJoin: boolean;
  joinMode: GoogleCalendarJoinMode;
  lastSyncedAt?: Date;
  // When the next read is due. A sync takes a short lease, so two API instances never read one calendar at once.
  nextSyncAt: Date;
  syncStartedAt?: Date;
  syncLeaseUntil?: Date;
  // Reads that failed in a row, for backing off
  syncFailures?: number;
  channel?: GoogleCalendarChannel;
  // Google wouldn't open a push channel; Taro keeps polling and asks again after this
  channelRetryAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

const channelSchema = new Schema<GoogleCalendarChannel>(
  {
    id: { type: String, required: true },
    tokenHash: { type: String, required: true, select: false },
    resourceId: { type: String, required: true },
    expiresAt: { type: Date, required: true },
    confirmedAt: { type: Date },
  },
  { _id: false }
);

const googleCalendarConnectionSchema = new Schema<GoogleCalendarConnectionDoc>(
  {
    companyId: { type: String, required: true, ref: 'Company' },
    userId: { type: String, required: true, ref: 'User' },
    email: { type: String, required: true },
    googleSub: { type: String, required: true },
    refreshTokenEnc: { type: String, select: false },
    status: { type: String, enum: ['active', 'reconnect'], default: 'active' },
    autoJoin: { type: Boolean, default: true },
    joinMode: { type: String, enum: ['all', 'organizer'], default: 'all' },
    lastSyncedAt: { type: Date },
    nextSyncAt: { type: Date, required: true },
    syncStartedAt: { type: Date },
    syncLeaseUntil: { type: Date },
    syncFailures: { type: Number },
    channel: { type: channelSchema, default: undefined },
    channelRetryAt: { type: Date },
  },
  { timestamps: true }
);

// One connection per person
googleCalendarConnectionSchema.index({ userId: 1 }, { unique: true });
googleCalendarConnectionSchema.index({ companyId: 1 });
googleCalendarConnectionSchema.index({ status: 1, nextSyncAt: 1 });
googleCalendarConnectionSchema.index({ 'channel.id': 1 }, { partialFilterExpression: { 'channel.id': { $type: 'string' } } });

export const GoogleCalendarConnectionModel = model<GoogleCalendarConnectionDoc>('GoogleCalendarConnection', googleCalendarConnectionSchema);
