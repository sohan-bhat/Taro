import { test } from 'node:test';
import assert from 'node:assert/strict';
import { flattenTranscript, normalizeSpeech, extractCommands } from './transcript';
import { parseIntentSimple } from './intent';

test('flattenTranscript joins spaceless words with spaces', () => {
  const segments = [
    { speaker: 'A', words: [{ word: 'Hey' }, { word: 'Taro' }, { word: 'post' }] },
    { speaker: 'A', words: [{ word: 'hello' }, { word: 'to' }, { word: 'general' }] },
  ];
  assert.equal(flattenTranscript(segments), 'Hey Taro post hello to general');
});

test('flattenTranscript handles space-prefixed words (Gladia style)', () => {
  const segments = [{ words: [{ word: ' Hey' }, { word: ' Taro' }, { word: ' post' }] }];
  assert.equal(flattenTranscript(segments), 'Hey Taro post');
});

test('flattenTranscript tolerates missing words arrays', () => {
  assert.equal(flattenTranscript([{ speaker: 'A' }, { words: [{ word: 'hi' }] }]), 'hi');
});

test('normalizeSpeech keeps commas and basic punctuation, strips symbols', () => {
  assert.equal(
    normalizeSpeech('Hey, Taro! Post "hello" to #general-chat.'),
    'hey, taro! post hello to #general-chat.'
  );
});

test('extractCommands finds command after punctuated wake word', () => {
  const commands = extractCommands('Okay so. Hey, Taro, post hello everyone to general. Thanks.');
  assert.equal(commands.length, 1);
  assert.ok(commands[0].startsWith('post hello everyone to general'));
});

test('extractCommands finds multiple commands', () => {
  const commands = extractCommands(
    'Hey Taro post hello to general. Some chatter. Hey Taro make a todo list in xyz about apples, bananas and cherries'
  );
  assert.equal(commands.length, 2);
  assert.ok(commands[0].startsWith('post hello to general'));
  assert.ok(commands[1].startsWith('make a todo list in xyz'));
});

test('extractCommands preserves commas inside the command', () => {
  const commands = extractCommands(
    'Hey Taro, make a todo list in project about reviewing the PR, fixing the deploy and emailing the client.'
  );
  assert.equal(commands.length, 1);
  assert.ok(commands[0].includes('the pr, fixing'));
});

test('extractCommands returns nothing without a wake word', () => {
  assert.deepEqual(extractCommands('just a normal meeting about roadmap planning'), []);
});

test('extractCommands ignores bare wake word with no command', () => {
  assert.deepEqual(extractCommands('hey taro'), []);
});

test('extractCommands matches variation "hey tarot"', () => {
  const commands = extractCommands('hey tarot make a list in xyz about one and two');
  assert.equal(commands.length, 1);
  assert.equal(commands[0], 'make a list in xyz about one and two');
});

test('extractCommands handles misrecognition "hey tara"', () => {
  const commands = extractCommands('hey tara post standup done to general');
  assert.deepEqual(commands, ['post standup done to general']);
});

test('fallback parser: canonical todo phrase yields 3 items end-to-end', () => {
  const transcript =
    'Hey Taro, make a todo list in the project channel about reviewing the PR, fixing the deploy and emailing the client.';
  const [command] = extractCommands(transcript);
  const intent = parseIntentSimple(command);
  assert.equal(intent.action, 'create_todo_list');
  assert.equal(intent.params.channel, 'project');
  assert.deepEqual(intent.params.items, [
    'reviewing the pr',
    'fixing the deploy',
    'emailing the client',
  ]);
});

test('fallback parser: canonical post phrase parses', () => {
  const intent = parseIntentSimple('post hello world to general');
  assert.equal(intent.action, 'post_message');
  assert.equal(intent.params.channel, 'general');
  assert.equal(intent.params.message, 'hello world');
});

test('wake word survives "he taro" (dropped y) from live ASR', () => {
  const text =
    'oh he tarro a go ahead and a post in the social channel talking about what date is today';
  const commands = extractCommands(text);
  assert.equal(commands.length, 1);
  assert.match(commands[0], /post in the social channel/i);
});

// Phonetic wake matching: catches misrecognitions, rejects lookalikes
test('phonetic wake: real ASR variants all trigger', () => {
  for (const head of ['hey', 'he', 'hi', 'hay']) {
    for (const name of ['taro', 'tarro', 'tero', 'terror', 'toro', 'tarot']) {
      const cmds = extractCommands(`${head} ${name} post hello team to social`);
      assert.equal(cmds.length, 1, `${head} ${name} should trigger`);
      assert.match(cmds[0], /post hello team/i);
    }
  }
});

test('phonetic wake: lookalike words do NOT trigger', () => {
  for (const phrase of [
    'hey there everyone welcome to the meeting',
    'hey team lets get started now',
    'hey hero of the day nice work',
    'so today is a good day to ship',
    'the number is zero for now',
  ]) {
    assert.equal(extractCommands(phrase).length, 0, `"${phrase}" must not trigger`);
  }
});
