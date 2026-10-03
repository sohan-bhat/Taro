/**
 * Per-meeting request tallies for the meetings list ("3 done, 1 turned off").
 * One aggregation counts every listed meeting's logs; the counting rules live
 * in tallyRows so they can be tested without a database.
 */

import type { PipelineStage } from 'mongoose';
import { DEFAULT_GITHUB_ACTIONS, type ActionOutcome, type MeetingTally } from '@taro/shared';
import { ActionLogModel, GithubConnectionModel } from '../db/models';
import { inferOutcome } from './outcomes';

export interface TallyRow {
  _id: { meetingId: string; outcome?: string | null; status?: string | null; action?: string | null };
  count: number;
}

const FIELD: Record<ActionOutcome, keyof MeetingTally> = {
  done: 'done',
  needs_you: 'needsYou',
  turned_off: 'turnedOff',
  failed: 'failed',
};

export const emptyTally = (): MeetingTally => ({ done: 0, needsYou: 0, turnedOff: 0, failed: 0 });

// Status and action ride along in the key only for logs written before outcomes were stored.
export function tallyPipeline(companyId: string, meetingIds: string[]): PipelineStage[] {
  return [
    { $match: { companyId, meetingId: { $in: meetingIds } } },
    {
      $group: {
        _id: { meetingId: '$meetingId', outcome: '$outcome', status: '$status', action: '$intent.action' },
        count: { $sum: 1 },
      },
    },
  ];
}

/** Adds the grouped counts up per meeting, inferring the outcome of older logs the way the dashboard does. */
export function tallyRows(rows: readonly TallyRow[], enabledActions: readonly string[]): Map<string, MeetingTally> {
  const tallies = new Map<string, MeetingTally>();
  for (const { _id, count } of rows) {
    const outcome =
      _id.outcome && Object.hasOwn(FIELD, _id.outcome)
        ? (_id.outcome as ActionOutcome)
        : inferOutcome(_id.status ?? undefined, _id.action, enabledActions);
    const field = FIELD[outcome];
    const tally = tallies.get(_id.meetingId) ?? emptyTally();
    tally[field] += count;
    tallies.set(_id.meetingId, tally);
  }
  return tallies;
}

/** Tallies for the given meetings of one workspace. Meetings with no requests are absent from the map. */
export async function meetingTallies(companyId: string, meetingIds: string[]): Promise<Map<string, MeetingTally>> {
  if (meetingIds.length === 0) return new Map();
  const [rows, github] = await Promise.all([
    ActionLogModel.aggregate<TallyRow>(tallyPipeline(companyId, meetingIds)),
    GithubConnectionModel.findOne({ companyId }).select('enabledActions').lean(),
  ]);
  return tallyRows(rows, github?.enabledActions ?? DEFAULT_GITHUB_ACTIONS);
}
