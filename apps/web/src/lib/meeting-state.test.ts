import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { SignInProvider, WorkspaceOverview } from '@taro/shared';
import { setupSteps, slackRequired } from './meeting-state';

type Setup = Pick<WorkspaceOverview, 'slack' | 'workspace' | 'ready'>;

function overview(signInWith: SignInProvider | undefined, opts: { slack?: boolean; claimed?: boolean; keys?: boolean } = {}): Setup {
  const keys = opts.keys ?? false;
  return {
    workspace: { signInWith, claimed: opts.claimed ?? true } as Setup['workspace'],
    slack: { connected: opts.slack ?? false },
    ready: { meetingBot: keys, llm: keys, stt: keys, slack: opts.slack ?? false, canJoinMeetings: keys },
  };
}

test('Slack is the first required step in a Slack workspace', () => {
  const { steps, todo, next } = setupSteps(overview('slack'));
  assert.deepEqual(steps.map((s) => s.id), ['slack', 'meetingBot', 'llm', 'stt']);
  assert.equal(todo, 4);
  assert.equal(next, 'slack');
  // Keys alone don't finish a Slack workspace, and neither does Slack nobody owns
  assert.equal(setupSteps(overview('slack', { keys: true })).todo, 1);
  assert.equal(setupSteps(overview('slack', { keys: true, slack: true, claimed: false })).todo, 1);
  assert.equal(setupSteps(overview('slack', { keys: true, slack: true })).todo, 0);
});

test('Google and Microsoft workspaces are set up without Slack', () => {
  for (const provider of ['google', 'microsoft'] as const) {
    const { steps, todo, next } = setupSteps(overview(provider));
    assert.deepEqual(steps.map((s) => s.id), ['meetingBot', 'llm', 'stt'], provider);
    assert.equal(todo, 3);
    assert.equal(next, 'meetingBot');
    assert.equal(setupSteps(overview(provider, { keys: true })).todo, 0, provider);
    assert.equal(slackRequired({ signInWith: provider }), false);
  }
});

test('a server from before Google and Microsoft sign-in sends no signInWith, which means Slack', () => {
  assert.equal(slackRequired({ signInWith: undefined as unknown as SignInProvider }), true);
  assert.deepEqual(setupSteps(overview(undefined)).steps[0].id, 'slack');
});
