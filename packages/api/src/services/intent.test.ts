import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseIntentSimple } from './intent';
import { INTENTS } from '@taro/shared';

test('fallback parses "create an issue about X"', () => {
  const intent = parseIntentSimple('create an issue about the login button being broken');
  assert.equal(intent.action, INTENTS.CREATE_GITHUB_ISSUE);
  assert.equal(intent.params.title, 'The login button being broken');
});

test('fallback parses "file a github issue that X"', () => {
  const intent = parseIntentSimple('file a github issue that the deploy keeps failing');
  assert.equal(intent.action, INTENTS.CREATE_GITHUB_ISSUE);
  assert.equal(intent.params.title, 'The deploy keeps failing');
});

test('fallback parses ASR-misheard "open a get hub issue about X"', () => {
  const intent = parseIntentSimple('open a get hub issue about dark mode.');
  assert.equal(intent.action, INTENTS.CREATE_GITHUB_ISSUE);
  assert.equal(intent.params.title, 'Dark mode');
});

test('issue command does not shadow todo list parsing', () => {
  const intent = parseIntentSimple(
    'make a todo list in the general channel about fixing the issue and shipping the fix'
  );
  assert.equal(intent.action, INTENTS.CREATE_TODO_LIST);
});

test('post message still parses normally', () => {
  const intent = parseIntentSimple('post hello team to social');
  assert.equal(intent.action, INTENTS.POST_MESSAGE);
  assert.equal(intent.params.channel, 'social');
});
