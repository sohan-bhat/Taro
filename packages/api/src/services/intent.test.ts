import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildIntent, parseIntent, parseIntentSimple, SYSTEM_PROMPT } from './intent';
import { COPY, INTENTS, cleanDashes } from '@taro/shared';

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

test('without a model, self-contained commands still parse', async () => {
  const intent = await parseIntent('post the build is green to engineering', undefined, null);
  assert.equal(intent.action, INTENTS.POST_MESSAGE);
  assert.equal(intent.params.channel, 'engineering');
});

test('without a model, a command that points at earlier discussion is refused, not guessed', async () => {
  const intent = await parseIntent('make a github issue about that', 'we talked about the export timing out', null);
  assert.equal(intent.action, INTENTS.UNKNOWN);
  assert.equal(intent.params.reason, `${COPY.noModel} Working out what “that” means needs the AI model.`);
});

test("without a model, a command the simple parser can't read says how to fix it", async () => {
  const intent = await parseIntent('do the thing we said', undefined, null);
  assert.equal(intent.action, INTENTS.UNKNOWN);
  assert.equal(intent.params.reason, COPY.noModel);
});

test('written fields never carry em or en dashes', () => {
  // The same cleanup the shared copy tests cover in depth
  assert.equal(cleanDashes('Export fails — only for large files.'), 'Export fails, only for large files.');
  assert.equal(cleanDashes('Takes 10–20 seconds'), 'Takes 10 to 20 seconds');

  const intent = buildIntent(
    {
      action: 'create_github_issue',
      confidence: 0.9,
      channel: 'general-chat',
      title: 'Export fails — large accounts',
      body: '## Summary\nExports time out — only for big customers.\n\n## Details\n- Takes 10–20 seconds',
      items: ['Docs — first', '—'],
      labels: ['needs-triage'],
      reason: 'I heard you — but which repo?',
    },
    'file an issue about that',
    'groq'
  );
  assert.equal(intent.params.title, 'Export fails, large accounts');
  assert.equal(intent.params.body, '## Summary\nExports time out, only for big customers.\n\n## Details\n- Takes 10 to 20 seconds');
  assert.deepEqual(intent.params.items, ['Docs, first']);
  assert.equal(intent.params.reason, 'I heard you, but which repo?');
  // Names are left exactly as the model gave them
  assert.equal(intent.params.channel, 'general-chat');
  assert.deepEqual(intent.params.labels, ['needs-triage']);
});

test('the prompt asks for plain sentences and its examples practice it', () => {
  assert.match(SYSTEM_PROMPT, /Never use em dashes or en dashes; use a comma, a period, or the word 'to'\. Never name who said something\./);
  const outputs = SYSTEM_PROMPT.split('\n').filter((line) => line.startsWith('Output:'));
  assert.ok(outputs.length > 10);
  for (const line of outputs) {
    assert.doesNotMatch(line, /[\u2013\u2014]/, line);
    assert.doesNotMatch(line, /Reported by|during a meeting|Sarah/, line);
  }
});

test('fallback parses tickets, with the tracker when one is named', () => {
  const plain = parseIntentSimple('file a ticket about the invite emails landing in spam');
  assert.equal(plain.action, INTENTS.CREATE_TICKET);
  assert.equal(plain.params.title, 'The invite emails landing in spam');
  assert.equal(plain.params.tracker, undefined);

  const jira = parseIntentSimple('make a jira ticket for rotating the staging password');
  assert.equal(jira.params.tracker, 'jira');
  assert.equal(jira.params.title, 'Rotating the staging password');

  const trailing = parseIntentSimple('create a ticket to update the docs in linear');
  assert.equal(trailing.params.tracker, 'linear');
  assert.equal(trailing.params.title, 'To update the docs');

  const close = parseIntentSimple('close ticket eng 42');
  assert.equal(close.action, INTENTS.CLOSE_TICKET);
  assert.equal(close.params.ticket, 'ENG-42');
  assert.equal(parseIntentSimple('reopen the linear ticket 7').params.tracker, 'linear');
  assert.equal(parseIntentSimple('close issue 9').action, INTENTS.CLOSE_GITHUB_ISSUE);
});

test('the model hears what is connected, and ticket fields are kept', async () => {
  const intent = buildIntent({ action: 'comment_ticket', confidence: 0.9, ticket: 'ENG-12', tracker: 'linear', body: 'Shipped.' }, 'c', 'groq');
  assert.equal(intent.params.ticket, 'ENG-12');
  assert.equal(intent.params.tracker, 'linear');
  assert.equal(buildIntent({ action: 'create_ticket', confidence: 1, tracker: 'asana' }, 'c', 'groq').params.tracker, undefined);
  assert.match(SYSTEM_PROMPT, /create_ticket/);
});
