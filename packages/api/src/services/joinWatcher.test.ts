import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MeetingModel } from '../db/models';
import { stageOf, stopWatchingJoins, watchJoin } from './joinWatcher';

test('maps MeetingBaas codes to what a joining meeting shows', () => {
  for (const code of ['queued', 'pickup_delayed', 'joining_call']) assert.equal(stageOf(code), 'starting', code);
  for (const code of ['in_waiting_room', 'in_waiting_for_host']) assert.equal(stageOf(code), 'lobby', code);
  for (const code of ['in_call_recording', 'in_call_not_recording', 'call_ended', 'bot_rejected', 'failed']) {
    assert.equal(stageOf(code), 'done', code);
  }
  assert.equal(stageOf(undefined), undefined);
});

/** Plays a list of status codes, one per poll, and records what was written to the meeting. */
async function run(t: import('node:test').TestContext, codes: Array<string | Error>, opts: { live?: boolean } = {}) {
  const writes: Array<Record<string, unknown>> = [];
  t.mock.method(MeetingModel, 'updateOne', (async (_filter: unknown, update: { $set: Record<string, unknown> }) => {
    writes.push(update.$set);
    return { matchedCount: opts.live ? 0 : 1 };
  }) as never);
  let polls = 0;
  const source = {
    async botStatus() {
      const next = codes[Math.min(polls++, codes.length - 1)];
      if (next instanceof Error) throw next;
      return next;
    },
  };
  watchJoin({ meetingId: 'm1', botId: 'b1', apiKey: 'k' }, { source, pollMs: 1, giveUpMs: 1_000 });
  // Long enough for every poll to run at 1ms apart
  await new Promise((resolve) => setTimeout(resolve, 80));
  stopWatchingJoins();
  return { writes, polls };
}

test('records the lobby once the bot asks to be let in, then stops', async (t) => {
  const { writes, polls } = await run(t, ['queued', 'joining_call', 'joining_call', 'in_waiting_room', 'in_waiting_room']);
  assert.equal(writes.length, 1);
  assert.equal(writes[0].joinStage, 'lobby');
  assert.ok(writes[0].lobbyAt instanceof Date);
  assert.equal(polls, 4);
});

test('stops without writing when the bot goes straight into the call', async (t) => {
  const { writes, polls } = await run(t, ['joining_call', 'in_call_recording', 'in_call_recording']);
  assert.equal(writes.length, 0);
  assert.equal(polls, 2);
});

test('stops when the meeting has already moved on', async (t) => {
  const { writes, polls } = await run(t, ['in_waiting_room', 'in_waiting_room'], { live: true });
  assert.equal(writes.length, 1);
  assert.equal(polls, 1);
});

test('gives up after repeated failures instead of polling forever', async (t) => {
  const { writes, polls } = await run(t, [new Error('down')]);
  assert.equal(writes.length, 0);
  assert.equal(polls, 5);
});
