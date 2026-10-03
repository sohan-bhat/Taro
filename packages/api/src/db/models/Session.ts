import { Schema, model } from 'mongoose';

export type SessionKind = 'web' | 'extension';

// A signed-in browser. Only a SHA-256 of the bearer token is stored; Mongo's
// TTL index deletes the session once it has gone unused past expiresAt.
// Extension sessions belong to the browser extension and can only send Taro
// to meetings, check on them, and make Taro leave.
export interface SessionDoc {
  tokenHash: string;
  userId: string;
  companyId: string;
  kind?: SessionKind;
  label?: string; // "Chrome on Mac", shown in the list of connected browsers
  expiresAt: Date;
  lastUsedAt?: Date;
  createdAt: Date;
}

const sessionSchema = new Schema<SessionDoc>(
  {
    tokenHash: { type: String, required: true, unique: true },
    userId: { type: String, required: true, ref: 'User' },
    companyId: { type: String, required: true, ref: 'Company' },
    kind: { type: String, enum: ['web', 'extension'], default: 'web' },
    label: { type: String },
    expiresAt: { type: Date, required: true },
    lastUsedAt: { type: Date },
  },
  { timestamps: { createdAt: true, updatedAt: false } }
);

sessionSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });
sessionSchema.index({ userId: 1 });
sessionSchema.index({ companyId: 1 });

export const SessionModel = model<SessionDoc>('Session', sessionSchema);
