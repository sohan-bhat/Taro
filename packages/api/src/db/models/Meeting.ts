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
    slackChannelId: { type: String }, // Channel where the meet link was detected
    slackThreadTs: { type: String }, // Message ts, for threading results back
    startedByName: { type: String }, // Slack display name of whoever posted the link
    startedByUserId: { type: String },
    archivedAt: { type: Date }, // cleared from main history, kept forever
    transcript: { type: String }, // Full transcript once the meeting completes
    liveTranscript: { type: String }, // What the realtime ASR has heard so far
    lastAudioAt: { type: Date }, // Last time meeting audio reached the realtime pipeline
    commandsProcessedAt: { type: Date }, // Claimed atomically to prevent double execution
    startedAt: { type: Date },
    endedAt: { type: Date },
  },
  { timestamps: true }
);

meetingSchema.index({ companyId: 1, status: 1 });

export const MeetingModel = model<Meeting>('Meeting', meetingSchema);
