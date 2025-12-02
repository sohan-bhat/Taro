import { Schema, model } from 'mongoose';
import type { ActionLog, ParsedIntent } from '@taro/shared';

const parsedIntentSchema = new Schema<ParsedIntent>(
  {
    action: { type: String, required: true },
    confidence: { type: Number, required: true },
    params: { type: Map, of: String },
  },
  { _id: false }
);

const actionLogSchema = new Schema<ActionLog>(
  {
    meetingId: { type: String, required: true, ref: 'Meeting' },
    companyId: { type: String, required: true, ref: 'Company' },
    command: { type: String, required: true },
    intent: { type: parsedIntentSchema, required: true },
    status: {
      type: String,
      enum: ['success', 'failed', 'clarification_needed'],
      required: true,
    },
    result: { type: String },
    errorMessage: { type: String },
  },
  { timestamps: true }
);

// Index for fetching logs by meeting
actionLogSchema.index({ meetingId: 1, createdAt: -1 });

export const ActionLogModel = model<ActionLog>('ActionLog', actionLogSchema);
