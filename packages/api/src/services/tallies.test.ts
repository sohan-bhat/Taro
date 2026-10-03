import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_GITHUB_ACTIONS } from '@taro/shared';
import { tallyPipeline, tallyRows, type TallyRow } from './tallies';

const row = (meetingId: string, count: number, key: Omit<TallyRow['_id'], 'meetingId'>): TallyRow => ({
  _id: { meetingId, ...key },
  count,
});

test('tallies add up stored outcomes per meeting', () => {
  const tallies = tallyRows(
    [
      row('a', 3, { outcome: 'done', status: 'success', action: 'post_message' }),
      row('a', 1, { outcome: 'done', status: 'success', action: 'create_github_issue' }),
      row('a', 1, { outcome: 'turned_off', status: 'clarification_needed', action: 'merge_pull_request' }),
      row('a', 2, { outcome: 'needs_you', status: 'clarification_needed', action: 'unknown' }),
      row('b', 1, { outcome: 'failed', status: 'failed', action: 'post_message' }),
    ],
    DEFAULT_GITHUB_ACTIONS
  );
  assert.deepEqual(tallies.get('a'), { done: 4, needsYou: 2, turnedOff: 1, failed: 0 });
  assert.deepEqual(tallies.get('b'), { done: 0, needsYou: 0, turnedOff: 0, failed: 1 });
  assert.equal(tallies.get('c'), undefined, 'a meeting with no requests is left for the caller to fill');
});

test('older logs without an outcome are inferred the way the dashboard infers them', () => {
  const tallies = tallyRows(
    [
      row('old', 2, { status: 'success', action: 'create_github_issue' }),
      row('old', 1, { status: 'failed', action: 'post_message' }),
      // Merging is off by default, so this was a refusal
      row('old', 1, { outcome: null, status: 'clarification_needed', action: 'merge_pull_request' }),
      // Commenting is on, so this was a question back
      row('old', 1, { status: 'clarification_needed', action: 'comment_github' }),
      row('old', 1, { status: 'clarification_needed', action: 'unknown' }),
    ],
    DEFAULT_GITHUB_ACTIONS
  );
  assert.deepEqual(tallies.get('old'), { done: 2, needsYou: 2, turnedOff: 1, failed: 1 });

  const allOn = tallyRows([row('old', 1, { status: 'clarification_needed', action: 'merge_pull_request' })], [
    ...DEFAULT_GITHUB_ACTIONS,
    'merge_pull_request',
  ]);
  assert.deepEqual(allOn.get('old'), { done: 0, needsYou: 1, turnedOff: 0, failed: 0 });
});

test('an unexpected stored outcome falls back to the status', () => {
  const tallies = tallyRows([row('x', 1, { outcome: 'constructor', status: 'success', action: 'post_message' })], []);
  assert.deepEqual(tallies.get('x'), { done: 1, needsYou: 0, turnedOff: 0, failed: 0 });
});

test('the aggregation is one $group over the workspace’s logs, keyed by meeting', () => {
  const pipeline = tallyPipeline('company-1', ['a', 'b']);
  assert.equal(pipeline.length, 2);
  assert.deepEqual(pipeline[0], { $match: { companyId: 'company-1', meetingId: { $in: ['a', 'b'] } } });
  const group = (pipeline[1] as { $group: { _id: Record<string, string> } }).$group;
  assert.equal(group._id.meetingId, '$meetingId');
});
