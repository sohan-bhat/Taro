import { Schema, model } from 'mongoose';
import type { GithubConnection } from '@taro/shared';

const githubConnectionSchema = new Schema<GithubConnection>(
  {
    companyId: { type: String, required: true, unique: true, ref: 'Company' },
    installationId: { type: String, required: true },
    accountLogin: { type: String },
    repo: { type: String }, // "owner/name"
    enabledActions: { type: [String], default: undefined },
    disconnectedAt: { type: Date },
  },
  { timestamps: true }
);

export const GithubConnectionModel = model<GithubConnection>(
  'GithubConnection',
  githubConnectionSchema
);
