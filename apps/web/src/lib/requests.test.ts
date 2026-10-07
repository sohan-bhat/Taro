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

test('a filed ticket reads as Taro posted it and links to the tracker', () => {
  const view = describeRequest({
    command: 'file a ticket about invites landing in spam',
    status: 'success',
    outcome: 'done',
    summary: 'Filed <https://linear.app/acme/issue/ENG-88|ENG-88> in Linear.',
    result: 'Filed ENG-88 in Linear: https://linear.app/acme/issue/ENG-88',
    intent: { action: 'create_ticket', params: { title: 'Invite emails land in spam', tracker: 'linear' } },
  });
  assert.equal(view.answer, 'Filed ENG-88 in Linear.');
  assert.equal(view.detail, 'Invite emails land in spam');
  assert.deepEqual(view.link, { label: 'View in Linear', href: 'https://linear.app/acme/issue/ENG-88', external: true });
});

test('a turned off ticket action points owners to Setup', () => {
  const view = describeRequest(
    {
      command: 'close ops 7',
      status: 'clarification_needed',
      outcome: 'turned_off',
      summary: COPY.turnedOff('close_ticket'),
      intent: { action: 'close_ticket', params: { ticket: 'OPS-7', tracker: 'jira' } },
    },
    { canEdit: true }
  );
  assert.equal(view.answer, 'Closing tickets is turned off for this workspace.');
  assert.deepEqual(view.link, { label: 'Change Jira permissions', href: '?view=setup', external: false });
});
