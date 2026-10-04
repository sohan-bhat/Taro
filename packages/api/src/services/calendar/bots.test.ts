import { test, type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { CalendarOccurrenceModel, CompanyModel } from '../../db/models';
import { encryptSecret } from '../../lib/crypto';
import { keyContext } from '../workspaceProviders';
import { syncOccurrenceBot } from './bots';

const COMPANY_ID = '6a1f00000000000000000001';
const NOW = new Date('2026-10-05T16:00:00Z');
const START = new Date('2026-10-07T21:00:00Z');
const MEET = 'https://meet.google.com/kdp-wqmx-tvr';

function workspace(ready: boolean) {
  const seal = (key: string, slot: 'meetingBaas' | 'llm') => encryptSecret(key, keyContext(COMPANY_ID, slot));
  return {
    _id: COMPANY_ID,
    name: 'Northwind',
    botName: 'Taro',
    providers: {
      meetingBaas: { keyEnc: seal('mb-test-key-0123456789', 'meetingBaas'), keyHint: 'mb-t…6789' },
      ...(ready ? { llm: { provider: 'groq', model: 'openai/gpt-oss-120b', keyEnc: seal('gsk_test_0123456789', 'llm'), keyHint: 'gsk_…6789' } } : {}),
      stt: { provider: 'groq', useLlmKey: true },
    },
  };
}

/** One occurrence held by a fake collection, and every MeetingBaas call and database update the sync makes. */
function fake(t: TestContext, occurrence: Record<string, unknown>, opts: { ready?: boolean; mbStatus?: number } = {}) {
  const updates: Array<{ filter: Record<string, unknown>; update: Record<string, unknown> }> = [];
  const calls: Array<{ method: string; path: string; body?: Record<string, unknown> }> = [];
  const doc = new CalendarOccurrenceModel({
    companyId: COMPANY_ID,
    seriesId: '6a1f00000000000000000002',
    uid: 'uid-1',
    recurrenceKey: '',
    start: START,
    end: new Date(START.getTime() + 30 * 60_000),
    meetUrl: MEET,
    platform: 'google_meet',
    status: 'scheduled',
    launchAt: new Date(START.getTime() - 60_000),
    expiresAt: new Date(START.getTime() + 7 * 86_400_000),
    botDirty: true,
    botRev: 3,
    ...occurrence,
  });
  t.mock.method(CalendarOccurrenceModel, 'findOneAndUpdate', (() => ({ select: async () => doc })) as never);
  t.mock.method(CalendarOccurrenceModel, 'updateOne', (async (filter: Record<string, unknown>, update: Record<string, unknown>) => {
    updates.push({ filter, update });
    return { modifiedCount: 1 };
  }) as never);
  t.mock.method(CompanyModel, 'findById', (async () => workspace(opts.ready ?? true)) as never);
  t.mock.method(globalThis, 'fetch', (async (url: string | URL, init?: RequestInit) => {
    calls.push({ method: init?.method ?? 'GET', path: String(url).replace('https://api.meetingbaas.com/v2', ''), body: init?.body ? JSON.parse(String(init.body)) : undefined });
    const status = opts.mbStatus ?? 200;
    const body = status >= 400 ? { success: false, message: 'Conflict' } : { success: true, data: { bot_id: '9f8e7d6c-0000-4000-8000-000000000009', message: 'ok' } };
    return new Response(JSON.stringify(body), { status });
  }) as never);
  return { updates, calls, id: String(doc._id) };
}

const BOT = { id: 'sched-1', joinAt: START, meetUrl: MEET, meetingId: '6a1f00000000000000000003', secretHash: 'hash', keyHint: 'mb-t…6789' };

test('a scheduled occurrence in a ready workspace gets a bot, recorded with its meeting and secret hash', async (t) => {
  const { updates, calls, id } = fake(t, {});
  await syncOccurrenceBot(id, NOW);
  assert.deepEqual(calls.map((c) => `${c.method} ${c.path}`), ['POST /bots/scheduled']);
  assert.equal(calls[0].body!.join_at, START.toISOString());
  const recorded = (updates[0].update.$set as { bot: Record<string, unknown> }).bot;
  assert.equal(recorded.id, '9f8e7d6c-0000-4000-8000-000000000009');
  assert.equal(recorded.meetUrl, MEET);
  assert.match(String(recorded.secretHash), /^[0-9a-f]{64}$/);
  assert.equal((calls[0].body!.extra as { taroMeetingId: string }).taroMeetingId, recorded.meetingId);
  // Done, and taken five minutes ahead to confirm, only if nothing changed meanwhile.
  assert.deepEqual(updates[1].filter.botRev, 3);
  assert.equal((updates[1].update.$set as { botDirty: boolean }).botDirty, false);
  assert.equal((updates[1].update.$set as { launchAt: Date }).launchAt.toISOString(), '2026-10-07T20:55:00.000Z');
});

test('a moved meeting moves its bot, and the record keeps the bot it moved', async (t) => {
  const later = new Date(START.getTime() + 60 * 60_000);
  const { updates, calls, id } = fake(t, { start: later, end: new Date(later.getTime() + 30 * 60_000), bot: BOT });
  await syncOccurrenceBot(id, NOW);
  assert.deepEqual(calls.map((c) => `${c.method} ${c.path}`), ['PATCH /bots/scheduled/sched-1']);
  assert.deepEqual(calls[0].body, { join_at: later.toISOString(), meeting_url: MEET });
  const recorded = (updates[0].update.$set as { bot: Record<string, unknown> }).bot;
  assert.deepEqual(recorded, { ...BOT, joinAt: later });
  assert.equal((updates[1].update.$set as { launchAt: Date }).launchAt.toISOString(), '2026-10-07T21:55:00.000Z');
});

test('a skipped occurrence lets its bot go', async (t) => {
  const { updates, calls, id } = fake(t, { status: 'skipped', bot: BOT });
  await syncOccurrenceBot(id, NOW);
  assert.deepEqual(calls.map((c) => `${c.method} ${c.path}`), ['DELETE /bots/scheduled/sched-1']);
  assert.deepEqual((updates[0].update.$unset as Record<string, number>).bot, 1);
});

test('a workspace that is not ready schedules nothing and cancels what it had', async (t) => {
  const none = fake(t, {}, { ready: false });
  await syncOccurrenceBot(none.id, NOW);
  assert.deepEqual(none.calls, []);
  t.mock.restoreAll();
  const held = fake(t, { bot: BOT }, { ready: false });
  await syncOccurrenceBot(held.id, NOW);
  assert.deepEqual(held.calls.map((c) => `${c.method} ${c.path}`), ['DELETE /bots/scheduled/sched-1']);
});

test('when MeetingBaas refuses, the reason is kept for Upcoming and the sync tries again later', async (t) => {
  const { updates, id } = fake(t, {}, { mbStatus: 401 });
  await syncOccurrenceBot(id, NOW);
  const set = updates[0].update.$set as { botError: string; botAttempts: number; botNextSyncAt: Date };
  assert.equal(set.botError, 'MeetingBaas rejected the API key. Update it in Setup.');
  assert.equal(set.botAttempts, 1);
  assert.equal(set.botNextSyncAt.toISOString(), '2026-10-05T16:01:00.000Z');
  assert.equal(updates.length, 1);
});
