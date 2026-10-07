import { Schema, model } from 'mongoose';
import type { TrackerSpace } from '@taro/shared';

/**
 * Jira, through the Taro app for Jira. Jira's own OAuth only ever acts as the person who signed in,
 * so a Jira admin installs Taro's Forge app instead, and Taro calls that app's web trigger. The app
 * makes every change as itself. The connection key from the app's admin page holds the trigger's
 * address and a shared secret; both are kept encrypted.
 */
export interface JiraConnectionDoc {
  companyId: string;
  triggerUrlEnc: string;
  secretEnc: string;
  // Matches a key pasted again, without decrypting every connection
  keyHash: string;
  siteUrl?: string;
  siteName?: string;
  projects: TrackerSpace[];
  defaultProjectKey?: string;
  // Subset of TICKET_CAPABILITIES; unset means DEFAULT_TICKET_ACTIONS
  enabledActions?: string[];
  // The app refused the signature (a new key was made) or is gone
  needsReconnect?: boolean;
  connectedByUserId?: string;
  createdAt: Date;
  updatedAt: Date;
}

const spaceSchema = new Schema<TrackerSpace>(
  { id: { type: String, required: true }, key: { type: String, required: true }, name: { type: String, required: true } },
  { _id: false }
);

const jiraConnectionSchema = new Schema<JiraConnectionDoc>(
  {
    companyId: { type: String, required: true, unique: true, ref: 'Company' },
    triggerUrlEnc: { type: String, required: true },
    secretEnc: { type: String, required: true },
    keyHash: { type: String, required: true },
    siteUrl: { type: String },
    siteName: { type: String },
    projects: { type: [spaceSchema], default: [] },
    defaultProjectKey: { type: String },
    enabledActions: { type: [String], default: undefined },
    needsReconnect: { type: Boolean },
    connectedByUserId: { type: String },
  },
  { timestamps: true }
);

export const JiraConnectionModel = model<JiraConnectionDoc>('JiraConnection', jiraConnectionSchema);
