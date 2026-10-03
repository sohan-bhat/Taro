import assert from 'node:assert/strict';
import { join } from 'node:path';
import { test } from 'node:test';
import { pathToFileURL } from 'node:url';
import { findWakeMatches, findWakeSpans, locateCommand, lowerAscii, normalizeSpeech, normalizeWithMap } from './wake';

interface DemoSnapshot {
  meetings: Array<{ _id: string; transcript?: string }>;
  details: Record<string, { actionLogs: Array<{ command: string }> } | undefined>;
}

// The frozen workspace behind /demo. Loaded by path so this package never compiles the web app.
async function loadDemoSnapshot(): Promise<DemoSnapshot> {
  const file = join(__dirname, '../../../apps/web/src/demo/snapshot.ts');
  return (await import(pathToFileURL(file).href)).snapshot;
}

const SAMPLE =
  'Beep! Hey Taro, can you go ahead and introduce yourself to the social channel on Slack? hey taro go ahead and ' +
  'create a new github branch Hey, Taro, can you go ahead and create a new pull request domain on GitHub? HAY TARO, close issue nine.';

test('wake phrases are found in text as people see it, with a following comma', () => {
  assert.equal(findWakeMatches(SAMPLE).length, 1, 'matching the cased text misses most of them');
  assert.deepEqual(
    findWakeSpans(SAMPLE).map((s) => SAMPLE.slice(s.start, s.end)),
    ['Hey Taro,', 'hey taro', 'Hey, Taro,', 'HAY TARO,']
  );
});

test('a stored command is located where it was said, in the speaker’s own casing', () => {
  const hit = locateCommand(SAMPLE, normalizeSpeech('can you go ahead and create a new pull request domain on GitHub?'));
  assert.ok(hit);
  assert.equal(SAMPLE.slice(hit.wake.start, hit.wake.end), 'Hey, Taro');
  assert.equal(SAMPLE.slice(hit.said.start, hit.said.end), 'can you go ahead and create a new pull request domain on GitHub?');

  const last = locateCommand(SAMPLE, 'close issue nine.');
  assert.ok(last);
  assert.equal(SAMPLE.slice(last.said.start, last.said.end), 'close issue nine.');
});

test('locateCommand returns null when the command never follows a wake phrase', () => {
  assert.equal(locateCommand(SAMPLE, 'merge pull request fifty seven'), null);
  assert.equal(locateCommand('post hello to general', 'post hello to general'), null);
  assert.equal(locateCommand(SAMPLE, '  '), null);
});

test('normalizeWithMap matches normalizeSpeech and maps every character back', () => {
  for (const text of [
    SAMPLE,
    '  Hey, Taro!  Post "hello" to #general-chat.  ',
    'Café ÜBER \u2605 tabs\tand\n\nnew lines \u{1F600} end',
    '',
  ]) {
    const { out, map } = normalizeWithMap(text);
    assert.equal(out, normalizeSpeech(text));
    assert.equal(map.length, out.length);
    for (let i = 0; i < out.length; i++) {
      if (i > 0) assert.ok(map[i] > map[i - 1], 'the map only moves forward');
      if (out[i] !== ' ') assert.equal(text[map[i]].toLowerCase(), out[i]);
    }
  }
});

test('lowerAscii lowercases A to Z and nothing else', () => {
  const s = 'HEY TÄRO, ÉCOLE';
  assert.equal(lowerAscii(s), 'hey tÄro, École');
  assert.equal(lowerAscii(s).length, s.length);
});

test('the demo snapshot: 27 wake phrases marked, 27 of 27 commands located', async () => {
  const snapshot = await loadDemoSnapshot();
  let spans = 0;
  let commands = 0;
  let located = 0;
  for (const meeting of snapshot.meetings) {
    const text = meeting.transcript ?? '';
    if (!text) continue;
    const found = findWakeSpans(text);
    spans += found.length;
    for (const s of found) {
      const [match] = findWakeMatches(lowerAscii(text.slice(s.start, s.end)));
      assert.equal(match?.start, 0, `span ${s.start} starts on its wake phrase`);
    }
    for (const log of snapshot.details[meeting._id]?.actionLogs ?? []) {
      commands++;
      const hit = locateCommand(text, log.command);
      if (!hit) continue;
      located++;
      assert.ok(found.some((s) => s.start === hit.wake.start), 'the located wake phrase is a marked one');
      assert.ok(normalizeSpeech(text.slice(hit.said.start, hit.said.end)).startsWith(log.command.slice(0, 60)));
    }
  }
  // Counts for the snapshot as exported. Re-exporting it changes them, so recheck and update both.
  assert.equal(spans, 27, 'wake phrases marked in the demo transcripts');
  assert.equal(commands, 27, 'commands in meetings that have a transcript');
  assert.equal(located, commands, 'every command is located in its transcript');
});
