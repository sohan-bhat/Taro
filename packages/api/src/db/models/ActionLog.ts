import { Schema, model } from 'mongoose';
import type { ActionOutcome, ParsedIntent } from '@taro/shared';

export interface ActionLogDoc {
  meetingId: string;
  companyId: string;
  command: string;
  intent: ParsedIntent;
  status: 'success' | 'failed' | 'clarification_needed';
  mode: 'live' | 'post_meeting';
  outcome?: ActionOutcome; // set by the executor; older logs only have status
  summary?: string; // the exact sentence Taro posted
  branch?: string; // the branch a pull request was opened from
  result?: string;
  errorMessage?: string;
  createdAt: Date;
  updatedAt: Date;
}

const parsedIntentSchema = new Schema<ParsedIntent>(
  {
    action: { type: String, required: true },
    confidence: { type: Number, required: true },
    params: { type: Schema.Types.Mixed }, // shape varies by action
    source: { type: String }, // provider id, or 'fallback_regex'
  },
  { _id: false }
);

const actionLogSchema = new Schema<ActionLogDoc>(
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
    mode: { type: String, enum: ['live', 'post_meeting'], default: 'post_meeting' },
    outcome: { type: String, enum: ['done', 'needs_you', 'turned_off', 'failed'] },
    summary: { type: String },
    branch: { type: String },
    result: { type: String },
    errorMessage: { type: String },
  },
  { timestamps: true }
);

actionLogSchema.index({ meetingId: 1, createdAt: -1 });
actionLogSchema.index({ companyId: 1 });

export const ActionLogModel = model<ActionLogDoc>('ActionLog', actionLogSchema);
