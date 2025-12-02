import { Schema, model } from 'mongoose';
import type { Meeting } from '@taro/shared';
import { MEETING_STATUS } from '@taro/shared';

const meetingSchema = new Schema<Meeting>(
  {
    companyId: { type: String, required: true, ref: 'Company' },
    meetUrl: { type: String, required: true },
    status: {
      type: String,
      enum: Object.values(MEETING_STATUS),
      default: MEETING_STATUS.PENDING,
    },
    botId: { type: String }, // MeetingBaas bot ID
    startedAt: { type: Date },
    endedAt: { type: Date },
  },
  { timestamps: true }
);

// Index for finding active meetings
meetingSchema.index({ companyId: 1, status: 1 });

export const MeetingModel = model<Meeting>('Meeting', meetingSchema);
