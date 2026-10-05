import { test, type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { COPY } from '@taro/shared';
import { CalendarOccurrenceModel, CalendarSeriesModel, CompanyModel, MeetingModel, UserModel } from '../../db/models';
import { encryptSecret } from '../../lib/crypto';
import { keyContext } from '../workspaceProviders';
import { runDue, skipLate, startOccurrence } from './scheduler';

const MIN = 60_000;
const NOW = new Date('2026-10-07T20:56:00Z');
const START = new Date('2026-10-07T21:00:00Z');

type Row = Record<string, unknown> & { _id: string };

// A tiny stand-in for the database: the operators the scheduler's filters use, matched and updated in one step,
// the way MongoDB applies findOneAndUpdate and updateMany atomically per document.
function matches(row: Row, filter: Record<string, unknown>): boolean {
  return Object.entries(filter).every(([field, condition]) => {
    const value = field.split('.').reduce<unknown>((v, key) => (v as Record<string, unknown> | undefined)?.[key], row) as Date | string | undefined;
    if (condition && typeof condition === 'object' && !(condition instanceof Date)) {
      const c = condition as Record<string, Date> & { $type?: string };
      if (c.$type && typeof value !== c.$type) return false;
      const t = value instanceof Date ? value.getTime() : NaN;
      if (c.$lte && !(t <= c.$lte.getTime())) return false;
      if (c.$gte && !(t >= c.$gte.getTime())) return false;
      if (c.$lt && !(t < c.$lt.getTime())) return false;
      return true;
    }
    return value === condition;
  });
}

function fakeOccurrences(t: TestContext, rows: Row[]) {
  t.mock.method(CalendarOccurrenceModel, 'findOneAndUpdate', ((filter: Record<string, unknown>, update: { $set: Record<string, unknown> }) => {
    const query = {
      select: () => query,
      then(resolve: (value: unknown) => void) {
        setImmediate(() => {
          const row = [...rows].sort((a, b) => (a.launchAt as Date).getTime() - (b.launchAt as Date).getTime()).find((r) => matches(r, filter));
          if (row) Object.assign(row, update.$set);
          resolve(row ? { ...row } : null);
        });
      },
    };
    return query;
  }) as never);
  t.mock.method(CalendarOccurrenceModel, 'updateMany', (async (filter: Record<string, unknown>, update: { $set: Record<string, unknown> }) => {
    const hit = rows.filter((r) => matches(r, filter));
    for (const row of hit) Object.assign(row, update.$set);
    return { modifiedCount: hit.length };
  }) as never);
  t.mock.method(CalendarOccurrenceModel, 'find', ((filter: Record<string, unknown>) => ({
    select: () => ({ limit: async () => rows.filter((r) => matches(r, filter)).map((r) => ({ ...r })) }),
  })) as never);
}

const occurrence = (id: string, start: Date, status = 'scheduled', lead = MIN): Row => ({
  _id: id,
  status,
  start,
  launchAt: new Date(start.getTime() - lead),
});

test('two schedulers running at once start each due meeting exactly once', async (t) => {
  const rows = [
    occurrence('due-now', START, 'scheduled', 5 * MIN),
    occurrence('due-too', new Date(NOW.getTime() - 2 * MIN)),
    occurrence('not-yet', new Date(START.getTime() + 30 * MIN)),
    occurrence('already-going', START, 'launched'),
    occurrence('skipped', START, 'skipped'),
  ];
  fakeOccurrences(t, rows);
  const started: string[] = [];
  const starter = async (o: { _id: unknown }) => {
    started.push(String(o._id));
    await new Promise((resolve) => setTimeout(resolve, 5));
  };

  const [a, b] = await Promise.all([runDue(NOW, starter as never), runDue(NOW, starter as never)]);
  assert.equal(a + b, 2);
  assert.deepEqual(started.sort(), ['due-now', 'due-too']);
  assert.equal(rows.find((r) => r._id === 'not-yet')!.status, 'scheduled');
  assert.equal(rows.find((r) => r._id === 'due-now')!.status, 'launched');

  // A third pass finds nothing left to take.
  assert.equal(await runDue(NOW, starter as never), 0);
});

test('a meeting more than 10 minutes past its start is skipped, not joined late', async (t) => {
  const rows = [
    occurrence('eleven-late', new Date(NOW.getTime() - 11 * MIN)),
    occurrence('nine-late', new Date(NOW.getTime() - 9 * MIN)),
    occurrence('upcoming', START),
  ];
  fakeOccurrences(t, rows);
  const calls: string[] = [];
  t.mock.method(globalThis, 'fetch', (async (url: string | URL, init?: RequestInit) => {
    calls.push(`${init?.method ?? 'GET'} ${String(url).replace('https://api.meetingbaas.com/v2', '')}`);
    return new Response('{}', { status: 200 });
  }) as never);
  assert.equal(await skipLate(NOW), 1);
  assert.deepEqual(
    rows.map((r) => [r._id, r.status, r.skipReason]),
    [
      ['eleven-late', 'skipped', 'late'],
      ['nine-late', 'scheduled', undefined],
      ['upcoming', 'scheduled', undefined],
    ]
  );
  // Nine minutes late is still taken: Taro joins.
  const started: string[] = [];
  await runDue(NOW, (async (o: { _id: unknown }) => void started.push(String(o._id))) as never);
  assert.deepEqual(started, ['nine-late']);
  assert.deepEqual(calls, []);
});

test('a late meeting whose scheduled bot went in anyway has that bot called back out', async (t) => {
  const rows: Row[] = [{ ...occurrence('late-with-bot', new Date(NOW.getTime() - 15 * MIN)), companyId: COMPANY_ID, bot: { id: 'sched-late' } }];
  fakeOccurrences(t, rows);
  t.mock.method(CompanyModel, 'findById', (async () => workspace(true)) as never);
  const calls: string[] = [];
  t.mock.method(globalThis, 'fetch', (async (url: string | URL, init?: RequestInit) => {
    calls.push(`${init?.method ?? 'GET'} ${String(url).replace('https://api.meetingbaas.com/v2', '')}`);
    return new Response(JSON.stringify({ success: false, message: 'Bot status does not allow deletion' }), { status: 409 });
  }) as never);
  assert.equal(await skipLate(NOW), 1);
  assert.equal(rows[0].status, 'skipped');
  assert.deepEqual(calls, ['DELETE /bots/scheduled/sched-late', 'POST /bots/sched-late/leave']);
});

// -------------------------------------------------------------------------------------------
// Starting one occurrence

const COMPANY_ID = '6a1f00000000000000000001';
const SERIES_ID = '6a1f00000000000000000002';
const BOT_MEETING_ID = '6a1f00000000000000000003';
const MEET = 'https://meet.google.com/kdp-wqmx-tvr';

function workspace(ready: boolean) {
  const seal = (key: string, slot: 'meetingBaas' | 'llm') => encryptSecret(key, keyContext(COMPANY_ID, slot));
  return {
    _id: COMPANY_ID,
    name: 'Northwind',
    botName: 'Taro',
    providers: ready
      ? {
          meetingBaas: { keyEnc: seal('mb-test-key-0123456789', 'meetingBaas'), keyHint: 'mb-t…6789' },
          llm: { provider: 'groq', model: 'openai/gpt-oss-120b', keyEnc: seal('gsk_test_0123456789', 'llm'), keyHint: 'gsk_…6789' },
          stt: { provider: 'groq', useLlmKey: true },
        }
      : {},
  };
}

function fakeWorld(t: TestContext, opts: { ready: boolean; scheduledStatus?: string }) {
  const meetings: Array<Record<string, unknown>> = [];
  const occurrenceUpdates: Array<Record<string, unknown>> = [];
  const calls: string[] = [];
  t.mock.method(CalendarSeriesModel, 'findOne', (async () => ({ _id: SERIES_ID, approval: 'approved', sponsorName: 'Maya Chen' })) as never);
  t.mock.method(UserModel, 'exists', (async () => null) as never);
  t.mock.method(CompanyModel, 'findById', (async () => workspace(opts.ready)) as never);
  t.mock.method(MeetingModel, 'findOne', (async () => null) as never);
  t.mock.method(MeetingModel, 'countDocuments', (async () => 0) as never);
  t.mock.method(MeetingModel, 'create', (async (doc: Record<string, unknown>) => {
    const saved = { _id: doc._id ?? '6a1f000000000000000000ff', ...doc, save: async () => {} };
    meetings.push(saved);
    return saved;
  }) as never);
  t.mock.method(CalendarOccurrenceModel, 'updateOne', (async (_filter: unknown, update: Record<string, unknown>) => {
    occurrenceUpdates.push(update);
    return { modifiedCount: 1 };
  }) as never);
  t.mock.method(globalThis, 'fetch', (async (url: string | URL, init?: RequestInit) => {
    calls.push(`${init?.method ?? 'GET'} ${String(url).replace('https://api.meetingbaas.com/v2', '')}`);
    if (String(url).includes('/bots/scheduled/')) {
      return new Response(JSON.stringify({ success: true, data: { status: opts.scheduledStatus ?? 'scheduled' } }), { status: 200 });
    }
    return new Response(JSON.stringify({ success: true, data: { bot_id: 'immediate-bot' } }), { status: 201 });
  }) as never);
  return { meetings, occurrenceUpdates, calls };
}

const due = (bot?: Record<string, unknown>) =>
  ({
    _id: 'occ-1',
    companyId: COMPANY_ID,
    seriesId: SERIES_ID,
    title: 'Export fix review',
    start: START,
    meetUrl: MEET,
    platform: 'google_meet',
    ...(bot ? { bot } : {}),
  }) as never;

const BOT = { id: 'sched-bot-1', joinAt: START, meetUrl: MEET, meetingId: BOT_MEETING_ID, secretHash: 'hash-of-secret', keyHint: 'mb-t…6789' };

test('a workspace that is not ready gets a meeting that says why, not a silent skip', async (t) => {
  const world = fakeWorld(t, { ready: false });
  await startOccurrence(due(), new Date(START.getTime() - MIN));
  assert.equal(world.meetings.length, 1);
  const [meeting] = world.meetings;
  assert.equal(meeting.status, 'error');
  assert.equal(meeting.source, 'calendar');
  assert.equal(meeting.title, 'Export fix review');
  assert.equal(meeting.startedByName, 'Maya Chen');
  assert.equal(meeting.errorMessage, COPY.notReady(['a MeetingBaas key', 'an AI model', 'transcription']));
  assert.deepEqual(world.calls, []);
  assert.deepEqual(world.occurrenceUpdates.at(-1), { $set: { meetingId: '6a1f000000000000000000ff' } });
});

test('a scheduled bot still coming becomes the meeting it streams into, with no second bot sent', async (t) => {
  const world = fakeWorld(t, { ready: true, scheduledStatus: 'scheduled' });
  await startOccurrence(due(BOT), new Date(START.getTime() - 5 * MIN));
  assert.deepEqual(world.calls, ['GET /bots/scheduled/sched-bot-1']);
  const [meeting] = world.meetings;
  assert.equal(meeting._id, BOT_MEETING_ID);
  assert.equal(meeting.botId, 'sched-bot-1');
  assert.equal(meeting.secretHash, 'hash-of-secret');
  assert.equal(meeting.status, 'pending');
  assert.equal(meeting.source, 'calendar');
  assert.equal(meeting.title, 'Export fix review');
});

test('a scheduled bot that failed is replaced by one Taro sends a minute before the start', async (t) => {
  const world = fakeWorld(t, { ready: true, scheduledStatus: 'failed' });
  await startOccurrence(due(BOT), new Date(START.getTime() - 5 * MIN));
  assert.equal(world.meetings.length, 0);
  assert.deepEqual(world.occurrenceUpdates.at(-1), {
    $set: { status: 'scheduled', launchAt: new Date(START.getTime() - MIN) },
    $unset: { launchedAt: 1, bot: 1 },
  });

  // A minute before the start, with no bot, Taro sends one right away.
  await startOccurrence(due(), new Date(START.getTime() - MIN));
  assert.ok(world.calls.includes('POST /bots'));
  assert.equal(world.meetings.at(-1)!.title, 'Export fix review');
});

// -------------------------------------------------------------------------------------------
// Meetings from connected Google Calendars

const PRIYA_ID = '6a1f0000000000000000aa01';
const SAM_ID = '6a1f0000000000000000aa02';

const fromGoogle = (holders: string[], bot?: Record<string, unknown>) =>
  ({
    _id: 'occ-g',
    companyId: COMPANY_ID,
    source: 'google',
    holders,
    title: 'Design review',
    start: START,
    meetUrl: MEET,
    platform: 'google_meet',
    ...(bot ? { bot } : {}),
  }) as never;

test('a meeting from Google Calendar is brought by the first member whose calendar has it, from Google Calendar', async (t) => {
  const world = fakeWorld(t, { ready: true, scheduledStatus: 'scheduled' });
  // Members come back from the database in any order; who connected first is what counts
  t.mock.method(UserModel, 'find', (() => ({
    select: async () => [
      { _id: SAM_ID, name: 'Sam Whitfield' },
      { _id: PRIYA_ID, name: 'Priya Raman' },
    ],
  })) as never);
  await startOccurrence(fromGoogle([PRIYA_ID, SAM_ID], BOT), new Date(START.getTime() - 5 * MIN));
  const [meeting] = world.meetings;
  assert.equal(meeting.source, 'google_calendar');
  assert.equal(meeting.startedByName, 'Priya Raman');
  assert.equal(meeting.startedByUserId, PRIYA_ID);
  assert.equal(meeting.title, 'Design review');
  assert.deepEqual(world.calls, ['GET /bots/scheduled/sched-bot-1']);
});

test('a Google Calendar meeting that nobody still in the workspace has is canceled, not joined', async (t) => {
  const world = fakeWorld(t, { ready: true });
  // Priya was removed from the workspace after her calendar brought the meeting in
  t.mock.method(UserModel, 'find', (() => ({ select: async () => [] })) as never);
  await startOccurrence(fromGoogle([PRIYA_ID]), new Date(START.getTime() - MIN));
  assert.equal(world.meetings.length, 0);
  assert.deepEqual(world.calls, []);
  assert.equal((world.occurrenceUpdates.at(-1)!.$set as { status: string }).status, 'canceled');
});
