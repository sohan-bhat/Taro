import { Schema, model } from 'mongoose';
import type { SlackConnection } from '@taro/shared';

const slackConnectionSchema = new Schema<SlackConnection>(
  {
    companyId: { type: String, required: true, ref: 'Company' },
    teamId: { type: String, required: true, unique: true },
    teamName: { type: String, required: true },
    accessToken: { type: String, required: true }, // Should be encrypted in production
    botUserId: { type: String, required: true },
  },
  { timestamps: true }
);

slackConnectionSchema.index({ companyId: 1 });

export const SlackConnectionModel = model<SlackConnection>('SlackConnection', slackConnectionSchema);
