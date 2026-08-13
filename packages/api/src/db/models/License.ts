import { Schema, model } from 'mongoose';
import type { License } from '@taro/shared';

const licenseSchema = new Schema<License>(
  {
    key: { type: String, required: true, unique: true },
    companyId: { type: String, default: null, ref: 'Company' },
    claimedAt: { type: Date },
    revokedAt: { type: Date },
  },
  { timestamps: true }
);

export const LicenseModel = model<License>('License', licenseSchema);
