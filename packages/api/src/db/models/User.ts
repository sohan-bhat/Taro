import { Schema, model } from 'mongoose';
import type { WorkspaceRole } from '@taro/shared';

// A person signed in to Taro. Slack vouches for a (team, user) pair. Google vouches for an account by
// its sub. Each person has one of the two.
export interface UserDoc {
  companyId: string;
  slackTeamId?: string;
  slackUserId?: string;
  signInWith?: 'google';
  accountId?: string;
  name: string;
  email?: string;
  avatarUrl?: string;
  role: WorkspaceRole;
  lastSeenAt?: Date;
  removedAt?: Date; // removed by an owner: signed out and refused at sign-in
  slackCheckedAt?: Date; // last time Slack confirmed they're still an active, full member
  createdAt: Date;
  updatedAt: Date;
}

const userSchema = new Schema<UserDoc>(
  {
    companyId: { type: String, required: true, ref: 'Company' },
    slackTeamId: { type: String },
    slackUserId: { type: String },
    signInWith: { type: String, enum: ['google'] },
    accountId: { type: String },
    name: { type: String, required: true },
    email: { type: String },
    avatarUrl: { type: String },
    role: { type: String, enum: ['owner', 'admin', 'member'], default: 'member' },
    lastSeenAt: { type: Date },
    removedAt: { type: Date },
    slackCheckedAt: { type: Date },
  },
  { timestamps: true }
);

// Partial, so the people who sign in with Google (no Slack identity) don't collide with each other.
userSchema.index(
  { slackTeamId: 1, slackUserId: 1 },
  { unique: true, partialFilterExpression: { slackUserId: { $type: 'string' } } }
);
userSchema.index({ signInWith: 1, accountId: 1 }, { unique: true, partialFilterExpression: { accountId: { $type: 'string' } } });
userSchema.index({ companyId: 1 });

export const UserModel = model<UserDoc>('User', userSchema);
