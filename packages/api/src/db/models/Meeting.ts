import { Schema, model } from 'mongoose';
import type { MeetingPlatform, MeetingStatus } from '@taro/shared';
import { MEETING_STATUS } from '@taro/shared';

export interface MeetingDoc {
  companyId: string;
  meetUrl: string;
  platform?: MeetingPlatform;
  status: MeetingStatus;
  source?: 'slack' | 'dashboard' | 'extension' | 'calendar' | 'slack_command';
  botId?: string; // MeetingBaas bot ID
  // Hash of the per-meeting secret MeetingBaas presents on its audio socket and webhooks
  secretHash?: string;
  slackChannelId?: string; // where the link was posted, for threading results back
  slackThreadTs?: string;
  slackChannelName?: string; // resolved at launch, for "Priya, from #product"
  title?: string; // the calendar event's title
  startedByName?: string;
  startedByUserId?: string; // Taro user, when the person has signed in to Taro
  startedBySlackUserId?: string; // Slack user, for launches from Slack
  errorMessage?: string;
  errorCode?: string; // MeetingBaas error_code from bot.failed
  archivedAt?: Date; // cleared from the main history, kept forever
  transcript?: string;
  liveTranscript?: string; // what realtime transcription has heard so far
  lastAudioAt?: Date; // last time audio reached the realtime pipeline
  // While joining: whether MeetingBaas is still starting the bot or it's asking to be let in
  joinStage?: 'starting' | 'lobby';
  lobbyAt?: Date; // when it started asking to be let in
  commandsProcessedAt?: Date; // claimed atomically so the end-of-call sweep runs once
  startedAt?: Date;
  endedAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

const meetingSchema = new Schema<MeetingDoc>(
  {
    companyId: { type: String, required: true, ref: 'Company' },
    meetUrl: { type: String, required: true },
    platform: { type: String, enum: ['google_meet', 'zoom', 'teams'] },
    status: {
      type: String,
      enum: Object.values(MEETING_STATUS),
      default: MEETING_STATUS.PENDING,
    },
    source: { type: String, enum: ['slack', 'dashboard', 'extension', 'calendar', 'slack_command'] },
    botId: { type: String },
    secretHash: { type: String, select: false },
    slackChannelId: { type: String },
    slackThreadTs: { type: String },
    slackChannelName: { type: String },
    title: { type: String },
    startedByName: { type: String },
    startedByUserId: { type: String },
    startedBySlackUserId: { type: String },
    errorMessage: { type: String },
    errorCode: { type: String },
    archivedAt: { type: Date },
    transcript: { type: String },
    liveTranscript: { type: String },
    lastAudioAt: { type: Date },
    joinStage: { type: String, enum: ['starting', 'lobby'] },
    lobbyAt: { type: Date },
    commandsProcessedAt: { type: Date },
    startedAt: { type: Date },
    endedAt: { type: Date },
  },
  { timestamps: true }
);

meetingSchema.index({ companyId: 1, createdAt: -1 });
meetingSchema.index({ companyId: 1, status: 1 });
meetingSchema.index({ botId: 1 }, { sparse: true });
meetingSchema.index({ meetUrl: 1, status: 1 });

export const MeetingModel = model<MeetingDoc>('Meeting', meetingSchema);
