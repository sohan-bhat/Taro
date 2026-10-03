import { Schema, model } from 'mongoose';

export interface GrantedInstallation {
  installationId: string;
  accountLogin: string;
  // "owner/name" repos the person who authorized can push to
  repos: string[];
}

// What a GitHub authorization proved, held until the person who started the
// connection confirms it from their own dashboard session. The callback can't
// connect directly: whoever's browser finishes the GitHub flow isn't
// necessarily the person who started it. Single use, gone after 15 minutes.
export interface GithubGrantDoc {
  tokenHash: string;
  companyId: string;
  userId: string;
  installations: GrantedInstallation[];
  expiresAt: Date;
}

const githubGrantSchema = new Schema<GithubGrantDoc>({
  tokenHash: { type: String, required: true, unique: true },
  companyId: { type: String, required: true },
  userId: { type: String, required: true },
  installations: {
    type: [{ _id: false, installationId: String, accountLogin: String, repos: [String] }],
    default: [],
  },
  expiresAt: { type: Date, required: true },
});

githubGrantSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

export const GithubGrantModel = model<GithubGrantDoc>('GithubGrant', githubGrantSchema);
