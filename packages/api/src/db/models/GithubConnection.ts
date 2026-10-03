import { Schema, model } from 'mongoose';

// A GitHub App installation: Taro acts as its own bot (`<app>[bot]`), never through a person's account.
export interface GithubConnectionDoc {
  companyId: string;
  installationId: string;
  accountLogin?: string; // org or user the app is installed on
  repo?: string; // default "owner/name"
  // Repos the person who connected could push to. Taro never acts outside these,
  // so connecting can't hand a workspace more access than that person had.
  allowedRepos?: string[];
  // Subset of GITHUB_CAPABILITIES the workspace allows; unset means DEFAULT_GITHUB_ACTIONS.
  enabledActions?: string[];
  disconnectedAt?: Date; // soft-disconnected: kept for one-click reconnect
  connectedByUserId?: string;
  createdAt: Date;
  updatedAt: Date;
}

const githubConnectionSchema = new Schema<GithubConnectionDoc>(
  {
    companyId: { type: String, required: true, unique: true, ref: 'Company' },
    installationId: { type: String, required: true },
    accountLogin: { type: String },
    repo: { type: String },
    allowedRepos: { type: [String], default: undefined },
    enabledActions: { type: [String], default: undefined },
    disconnectedAt: { type: Date },
    connectedByUserId: { type: String },
  },
  { timestamps: true }
);

export const GithubConnectionModel = model<GithubConnectionDoc>('GithubConnection', githubConnectionSchema);
