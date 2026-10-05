import { Schema, model } from 'mongoose';

// What Google sent back when someone connected their calendar, held until the person who started it
// confirms it from their own dashboard session. The callback can't connect directly: whoever's browser
// finishes the Google flow isn't necessarily the person who started it. Single use, gone after 15 minutes.
export interface GoogleCalendarGrantDoc {
  tokenHash: string;
  companyId: string;
  userId: string;
  email: string;
  googleSub: string;
  // Encrypted for this person, the same way the connection keeps it
  refreshTokenEnc: string;
  expiresAt: Date;
}

const googleCalendarGrantSchema = new Schema<GoogleCalendarGrantDoc>({
  tokenHash: { type: String, required: true, unique: true },
  companyId: { type: String, required: true },
  userId: { type: String, required: true },
  email: { type: String, required: true },
  googleSub: { type: String, required: true },
  refreshTokenEnc: { type: String, required: true },
  expiresAt: { type: Date, required: true },
});

googleCalendarGrantSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

export const GoogleCalendarGrantModel = model<GoogleCalendarGrantDoc>('GoogleCalendarGrant', googleCalendarGrantSchema);
