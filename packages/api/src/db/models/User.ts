import { Schema, model } from 'mongoose';
import type { WorkspaceRole } from '@taro/shared';

// A person signed in with Slack. Identity is the (team, user) pair Slack vouches for.
export interface UserDoc {
  companyId: string;
  slackTeamId: string;
  slackUserId: string;
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
    slackTeamId: { type: String, required: true },
    slackUserId: { type: String, required: true },
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

userSchema.index({ slackTeamId: 1, slackUserId: 1 }, { unique: true });
userSchema.index({ companyId: 1 });

export const UserModel = model<UserDoc>('User', userSchema);
