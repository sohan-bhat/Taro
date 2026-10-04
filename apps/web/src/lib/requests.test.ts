import { test } from 'node:test';
import assert from 'node:assert/strict';
import { COPY } from '@taro/shared';
import { describeRequest, type RequestLog } from './requests';

const post: RequestLog = {
  command: 'tell engineering the deploy is done',
  status: 'clarification_needed',
  outcome: 'turned_off',
  summary: COPY.slackNotConnected,
  intent: { action: 'post_message', params: { channel: 'engineering', message: 'the deploy is done' } },
};

test('a post in a workspace without Slack says so, and owners get a way to set it up', () => {
  const view = describeRequest(post, { canEdit: true });
  assert.equal(view.answer, COPY.slackNotConnected);
  assert.equal(view.label?.text, 'Turned off');
  assert.deepEqual(view.link, { label: 'Set up Slack', href: '?view=setup', external: false });
  // Members see why, without a link they can't use
  assert.equal(describeRequest(post, { canEdit: false }).link, undefined);
});

test('a GitHub action the workspace turned off still points to its permissions', () => {
  const merge: RequestLog = {
    command: 'merge pull request fifty seven',
    status: 'clarification_needed',
    outcome: 'turned_off',
    summary: COPY.turnedOff('merge_pull_request'),
    intent: { action: 'merge_pull_request', params: { issueNumber: 57 } },
  };
  assert.equal(describeRequest(merge, { canEdit: true }).link?.label, 'Change GitHub permissions');
});
