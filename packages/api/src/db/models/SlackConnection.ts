import { Schema, model } from 'mongoose';

export interface SlackConnectionDoc {
  companyId: string;
  teamId: string;
  teamName: string;
  // Bot token, encrypted with the team ID bound as context (see lib/crypto)
  accessToken: string;
  botUserId: string;
  installedByUserId?: string;
  createdAt: Date;
  updatedAt: Date;
}

const slackConnectionSchema = new Schema<SlackConnectionDoc>(
  {
    companyId: { type: String, required: true, ref: 'Company' },
    teamId: { type: String, required: true, unique: true },
    teamName: { type: String, required: true },
    accessToken: { type: String, required: true },
    botUserId: { type: String, required: true },
    installedByUserId: { type: String },
  },
  { timestamps: true }
);

slackConnectionSchema.index({ companyId: 1 });

export const SlackConnectionModel = model<SlackConnectionDoc>('SlackConnection', slackConnectionSchema);
