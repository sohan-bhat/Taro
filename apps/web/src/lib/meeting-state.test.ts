import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { SignInProvider, WorkspaceOverview } from '@taro/shared';
import { meetingPhase, setupSteps, slackRequired } from './meeting-state';

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

test('Google workspaces are set up without Slack', () => {
  const { steps, todo, next } = setupSteps(overview('google'));
  assert.deepEqual(steps.map((s) => s.id), ['meetingBot', 'llm', 'stt']);
  assert.equal(todo, 3);
  assert.equal(next, 'meetingBot');
  assert.equal(setupSteps(overview('google', { keys: true })).todo, 0);
  assert.equal(slackRequired({ signInWith: 'google' }), false);
});

test('a server from before Google sign-in sends no signInWith, which means Slack', () => {
  assert.equal(slackRequired({ signInWith: undefined as unknown as SignInProvider }), true);
  assert.deepEqual(setupSteps(overview(undefined)).steps[0].id, 'slack');
});

test('a joining meeting is starting until the bot asks to be let in', () => {
  assert.equal(meetingPhase({ status: 'joining', joinStage: 'starting' }), 'starting');
  assert.equal(meetingPhase({ status: 'joining', joinStage: 'lobby' }), 'lobby');
  // A server from before join stages: as before, the lobby
  assert.equal(meetingPhase({ status: 'joining' }), 'lobby');
});
