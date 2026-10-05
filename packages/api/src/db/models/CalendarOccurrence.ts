import { Schema, model } from 'mongoose';
import type { MeetingPlatform } from '@taro/shared';

// scheduled: Taro joins at the start. needs_approval: waits for an owner or admin. launched: became a
// meeting. skipped: a person skipped it, or the server was too late. canceled: the invitation went away.
export type OccurrenceStatus = 'scheduled' | 'needs_approval' | 'launched' | 'skipped' | 'canceled';

export type OccurrenceSource = 'invite' | 'google';

/** A MeetingBaas scheduled bot waiting to join this occurrence. */
export interface OccurrenceBot {
  // MeetingBaas reuses this as the bot's own ID once it joins
  id: string;
  joinAt: Date;
  meetUrl: string;
  // The meeting record it becomes; made when Taro confirms the bot shortly before the start
  meetingId: string;
  // Hash of the per-meeting secret in its audio stream and callback URLs
  secretHash: string;
  // Which MeetingBaas key made it, as the masked hint
  keyHint?: string;
}

/**
 * One time Taro joins a meeting from a calendar: a one-off event, or one occurrence of a series. It
 * comes from an invitation to Taro's address (a series), or from members' connected Google Calendars.
 */
export interface CalendarOccurrenceDoc {
  companyId: string;
  // Unset means an invitation, from before Google Calendar
  source?: OccurrenceSource;
  // Invitations: the series it belongs to
  seriesId?: string;
  // The event's UID. Google Calendar's are kept as "g:" and a digest of its iCalUID.
  uid: string;
  // '' for a one-off event, else the ISO time of the occurrence's original start (its RECURRENCE-ID)
  recurrenceKey: string;
  // Google Calendar: the connected members whose calendars have it and who want Taro there. When the
  // last one goes, it's canceled.
  holders?: string[];
  recurring: boolean;
  title?: string;
  organizerEmail?: string;
  organizerName?: string;
  // Who sent the invitation, for meetings waiting for approval
  senderEmail?: string;
  start: Date;
  end: Date;
  meetUrl: string;
  platform: MeetingPlatform;
  status: OccurrenceStatus;
  // When the scheduler takes it: to confirm its scheduled bot, or to send one right away
  launchAt: Date;
  skipReason?: 'person' | 'late';
  skippedByUserId?: string;
  launchedAt?: Date;
  // The meeting it became
  meetingId?: string;
  bot?: OccurrenceBot;
  // MeetingBaas may not match this occurrence yet (a bot to schedule, move, or cancel). botRev counts
  // changes, so a sync that started before one doesn't mark the newer change done.
  botDirty?: boolean;
  botRev?: number;
  botNextSyncAt?: Date;
  botLeaseUntil?: Date;
  botAttempts?: number;
  // Why MeetingBaas wouldn't schedule it, shown in Upcoming
  botError?: string;
  // A week after it ends, the record goes away
  expiresAt: Date;
  createdAt: Date;
  updatedAt: Date;
}

const botSchema = new Schema<OccurrenceBot>(
  {
    id: { type: String, required: true },
    joinAt: { type: Date, required: true },
    meetUrl: { type: String, required: true },
    meetingId: { type: String, required: true },
    secretHash: { type: String, required: true, select: false },
    keyHint: { type: String },
  },
  { _id: false }
);

const calendarOccurrenceSchema = new Schema<CalendarOccurrenceDoc>(
  {
    companyId: { type: String, required: true, ref: 'Company' },
    source: { type: String, enum: ['invite', 'google'] },
    seriesId: { type: String, ref: 'CalendarSeries' },
    uid: { type: String, required: true },
    recurrenceKey: { type: String, default: '' },
    holders: { type: [String], default: undefined },
    recurring: { type: Boolean, default: false },
    title: { type: String },
    organizerEmail: { type: String },
    organizerName: { type: String },
    senderEmail: { type: String },
    start: { type: Date, required: true },
    end: { type: Date, required: true },
    meetUrl: { type: String, required: true },
    platform: { type: String, enum: ['google_meet', 'zoom', 'teams'], required: true },
    status: {
      type: String,
      enum: ['scheduled', 'needs_approval', 'launched', 'skipped', 'canceled'],
      required: true,
    },
    launchAt: { type: Date, required: true },
    skipReason: { type: String, enum: ['person', 'late'] },
    skippedByUserId: { type: String },
    launchedAt: { type: Date },
    meetingId: { type: String },
    bot: { type: botSchema, default: undefined },
    botDirty: { type: Boolean },
    botRev: { type: Number, default: 0 },
    botNextSyncAt: { type: Date },
    botLeaseUntil: { type: Date },
    botAttempts: { type: Number },
    botError: { type: String },
    expiresAt: { type: Date, required: true },
  },
  { timestamps: true }
);

calendarOccurrenceSchema.index({ companyId: 1, uid: 1, recurrenceKey: 1 }, { unique: true });
calendarOccurrenceSchema.index({ status: 1, launchAt: 1 });
calendarOccurrenceSchema.index({ status: 1, start: 1 });
calendarOccurrenceSchema.index({ companyId: 1, start: 1 });
calendarOccurrenceSchema.index({ seriesId: 1, start: 1 });
calendarOccurrenceSchema.index({ holders: 1, start: 1 }, { partialFilterExpression: { source: 'google' } });
calendarOccurrenceSchema.index({ status: 1, 'bot.joinAt': 1 }, { partialFilterExpression: { 'bot.id': { $type: 'string' } } });
calendarOccurrenceSchema.index({ botNextSyncAt: 1 }, { partialFilterExpression: { botDirty: true } });
calendarOccurrenceSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

export const CalendarOccurrenceModel = model<CalendarOccurrenceDoc>('CalendarOccurrence', calendarOccurrenceSchema);
