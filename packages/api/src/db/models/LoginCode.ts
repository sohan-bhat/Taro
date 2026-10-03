import { Schema, model } from 'mongoose';

// Single-use code that carries a finished Slack sign-in from the API callback to
// the dashboard, which trades it for a session token. It never holds the token
// itself, lives two minutes, and is deleted on first use.
export interface LoginCodeDoc {
  codeHash: string;
  userId: string;
  companyId: string;
  expiresAt: Date;
}

const loginCodeSchema = new Schema<LoginCodeDoc>({
  codeHash: { type: String, required: true, unique: true },
  userId: { type: String, required: true },
  companyId: { type: String, required: true },
  expiresAt: { type: Date, required: true },
});

loginCodeSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

export const LoginCodeModel = model<LoginCodeDoc>('LoginCode', loginCodeSchema);
