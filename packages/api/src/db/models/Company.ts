import { Schema, model } from 'mongoose';
import type { Company } from '@taro/shared';

const companySchema = new Schema<Company>(
  {
    name: { type: String, required: true },
    domain: { type: String, required: true, unique: true },
  },
  { timestamps: true }
);

export const CompanyModel = model<Company>('Company', companySchema);
