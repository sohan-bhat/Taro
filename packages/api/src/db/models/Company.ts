import { Schema, model } from 'mongoose';

// A provider key encrypted at rest; only the hint is ever shown back to anyone.
export interface StoredKey {
  keyEnc: string;
  keyHint: string;
  validatedAt?: Date;
}

export interface LlmConfigDoc extends StoredKey {
  provider: string;
  model: string;
  baseUrl?: string;
}

export interface SttConfigDoc {
  provider: string;
  model?: string;
  // Reuse the AI model's key (same provider) instead of storing a second copy
  useLlmKey?: boolean;
  keyEnc?: string;
  keyHint?: string;
  validatedAt?: Date;
}

// A Taro workspace. Internally still "company" (the collection predates workspaces).
export interface CompanyDoc {
  name: string;
  // A Slack workspace's own team. A Google workspace's is the team it added Taro to, if any.
  slackTeamId?: string;
  slackTeamDomain?: string;
  // Workspaces made by Google sign-in; unset for Slack workspaces. directoryId says whose accounts
  // belong: a Google Workspace domain, or "user:<id>" for one personal account.
  signInWith?: 'google';
  directoryId?: string;
  personal?: boolean;
  botName?: string;
  onboardedAt?: Date;
  // Set once, atomically, when the first owner is decided
  ownerClaimedAt?: Date;
  // The unguessable part of this workspace's Taro address for calendar invitations
  inviteToken?: string;
  providers?: {
    meetingBaas?: StoredKey;
    llm?: LlmConfigDoc;
    stt?: SttConfigDoc;
  };
  createdAt: Date;
  updatedAt: Date;
}

const storedKey = {
  keyEnc: { type: String, required: true },
  keyHint: { type: String, required: true },
  validatedAt: { type: Date },
};

const companySchema = new Schema<CompanyDoc>(
  {
    name: { type: String, required: true },
    slackTeamId: { type: String },
    slackTeamDomain: { type: String },
    signInWith: { type: String, enum: ['google'] },
    directoryId: { type: String },
    personal: { type: Boolean },
    botName: { type: String },
    onboardedAt: { type: Date },
    ownerClaimedAt: { type: Date },
    inviteToken: { type: String },
    providers: {
      meetingBaas: { type: new Schema(storedKey, { _id: false }), default: undefined },
      llm: {
        type: new Schema(
          {
            ...storedKey,
            provider: { type: String, required: true },
            model: { type: String, required: true },
            baseUrl: { type: String },
          },
          { _id: false }
        ),
        default: undefined,
      },
      stt: {
        type: new Schema(
          {
            provider: { type: String, required: true },
            model: { type: String },
            useLlmKey: { type: Boolean },
            keyEnc: { type: String },
            keyHint: { type: String },
            validatedAt: { type: Date },
          },
          { _id: false }
        ),
        default: undefined,
      },
    },
  },
  { timestamps: true }
);

companySchema.index({ slackTeamId: 1 }, { unique: true, partialFilterExpression: { slackTeamId: { $type: 'string' } } });
companySchema.index({ signInWith: 1, directoryId: 1 }, { unique: true, partialFilterExpression: { directoryId: { $type: 'string' } } });
companySchema.index({ inviteToken: 1 }, { unique: true, partialFilterExpression: { inviteToken: { $type: 'string' } } });

export const CompanyModel = model<CompanyDoc>('Company', companySchema);
