import { Schema, model } from 'mongoose';
import type { MeetingPlatform } from '@taro/shared';

// approved: Taro joins. pending: an owner or admin has to approve it first. declined: never joins.
export type SeriesApproval = 'approved' | 'pending' | 'declined';

// One occurrence of a series that differs from the rule: moved, retitled, relinked, or canceled.
export interface SeriesOverride {
  recurrenceId: Date;
  sequence: number;
  stamp?: Date;
  canceled: boolean;
  start?: Date;
  end?: Date;
  title?: string;
  meetUrl?: string;
  platform?: MeetingPlatform;
}

/**
 * A meeting someone invited Taro to: one event, or a recurring series and the occurrences that differ
 * from it, keyed by the invitation's UID within one workspace. It keeps only what scheduling needs:
 * no description and no guest list.
 */
export interface CalendarSeriesDoc {
  companyId: string;
  uid: string;
  // SEQUENCE and DTSTAMP of the series itself, so an older copy of the invitation can't undo a newer one
  sequence: number;
  stamp?: Date;
  // False until the series itself arrives (one changed occurrence can come on its own)
  hasMaster: boolean;
  title?: string;
  organizerEmail?: string;
  organizerName?: string;
  meetUrl?: string;
  platform?: MeetingPlatform;
  // A one-off event's times
  start?: Date;
  end?: Date;
  // A recurring series' timing (iCalendar), expanded over a rolling window
  schedule?: string;
  overrides: SeriesOverride[];
  canceledAt?: Date;
  approval: SeriesApproval;
  // Who vouched for it: the member who invited Taro, or the owner or admin who approved it
  sponsorName?: string;
  sponsorUserId?: string;
  // Who the mail that last changed it came from, shown to whoever decides whether to approve it
  senderEmail?: string;
  decidedByUserId?: string;
  // Occurrences exist up to here; the daily pass moves it forward
  expandedUntil?: Date;
  // Set once nothing is left to join, so the record goes away a week later
  expiresAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

const overrideSchema = new Schema<SeriesOverride>(
  {
    recurrenceId: { type: Date, required: true },
    sequence: { type: Number, default: 0 },
    stamp: { type: Date },
    canceled: { type: Boolean, default: false },
    start: { type: Date },
    end: { type: Date },
    title: { type: String },
    meetUrl: { type: String },
    platform: { type: String, enum: ['google_meet', 'zoom', 'teams'] },
  },
  { _id: false }
);

const calendarSeriesSchema = new Schema<CalendarSeriesDoc>(
  {
    companyId: { type: String, required: true, ref: 'Company' },
    uid: { type: String, required: true },
    sequence: { type: Number, default: 0 },
    stamp: { type: Date },
    hasMaster: { type: Boolean, default: false },
    title: { type: String },
    organizerEmail: { type: String },
    organizerName: { type: String },
    meetUrl: { type: String },
    platform: { type: String, enum: ['google_meet', 'zoom', 'teams'] },
    start: { type: Date },
    end: { type: Date },
    schedule: { type: String },
    overrides: { type: [overrideSchema], default: [] },
    canceledAt: { type: Date },
    approval: { type: String, enum: ['approved', 'pending', 'declined'], default: 'pending' },
    sponsorName: { type: String },
    sponsorUserId: { type: String },
    senderEmail: { type: String },
    decidedByUserId: { type: String },
    expandedUntil: { type: Date },
    expiresAt: { type: Date },
  },
  // Two copies of an invitation can arrive at once; the second save notices and starts over.
  { timestamps: true, optimisticConcurrency: true }
);

calendarSeriesSchema.index({ companyId: 1, uid: 1 }, { unique: true });
calendarSeriesSchema.index({ companyId: 1, approval: 1 });
calendarSeriesSchema.index({ expandedUntil: 1 }, { partialFilterExpression: { schedule: { $type: 'string' } } });
calendarSeriesSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

export const CalendarSeriesModel = model<CalendarSeriesDoc>('CalendarSeries', calendarSeriesSchema);
