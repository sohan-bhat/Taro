import { Schema, model } from 'mongoose';

export interface AccessTokenDoc {
  tokenHash: string;
  companyId: string;
  lastUsedAt?: Date;
  createdAt: Date;
}

const accessTokenSchema = new Schema<AccessTokenDoc>(
  {
    tokenHash: { type: String, required: true, unique: true },
    companyId: { type: String, required: true, ref: 'Company' },
    lastUsedAt: { type: Date },
  },
  { timestamps: true }
);

accessTokenSchema.index({ companyId: 1 });

export const AccessTokenModel = model<AccessTokenDoc>('AccessToken', accessTokenSchema);
