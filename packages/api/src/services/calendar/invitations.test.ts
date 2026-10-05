import { test, type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { CalendarOccurrenceModel, CompanyModel } from '../../db/models';
import { encryptSecret } from '../../lib/crypto';
import { ConflictError, NotFoundError } from '../../lib/errors';
import { memoryModel, useMemory } from '../../lib/testing/memoryModel';
import { keyContext } from '../workspaceProviders';
import { decideOccurrence, restoreOccurrence, skipOccurrence, upcomingFor } from './invitations';

const COMPANY_ID = '6a1f00000000000000000001';
const NOW = new Date('2026-10-07T20:00:00Z');
const MIN = 60_000;

function fake(t: TestContext, occurrence: Record<string, unknown>, mbStatus = 200) {
  const row = { _id: 'occ-1', companyId: COMPANY_ID, status: 'scheduled', botRev: 1, ...occurrence };
  const updates: Array<Record<string, unknown>> = [];
  const calls: string[] = [];
  t.mock.method(CalendarOccurrenceModel, 'findOne', (async () => ({ ...row })) as never);
  t.mock.method(CalendarOccurrenceModel, 'findOneAndUpdate', (async (_filter: unknown, update: Record<string, unknown>) => {
    updates.push(update);
    return { ...row, botRev: 2 };
  }) as never);
  t.mock.method(CalendarOccurrenceModel, 'updateOne', (async (_filter: unknown, update: Record<string, unknown>) => {
    updates.push(update);
    return { modifiedCount: 1 };
  }) as never);
  t.mock.method(CompanyModel, 'findById', (async () => ({
    _id: COMPANY_ID,
    providers: { meetingBaas: { keyEnc: encryptSecret('mb-test-key-0123456789', keyContext(COMPANY_ID, 'meetingBaas')), keyHint: 'mb-t…6789' } },
  })) as never);
  t.mock.method(globalThis, 'fetch', (async (url: string | URL, init?: RequestInit) => {
    calls.push(`${init?.method ?? 'GET'} ${String(url).replace('https://api.meetingbaas.com/v2', '')}`);
    return new Response(JSON.stringify(mbStatus === 200 ? { success: true, data: { message: 'ok' } } : { success: false, message: 'Conflict' }), { status: mbStatus });
  }) as never);
  return { updates, calls };
}

const BOT = { id: 'sched-1', joinAt: new Date('2026-10-07T21:00:00Z'), meetUrl: 'https://meet.google.com/kdp-wqmx-tvr', meetingId: 'm1' };

test('Skip cancels the scheduled bot right away', async (t) => {
  const { updates, calls } = fake(t, { start: new Date(NOW.getTime() + 60 * MIN), bot: BOT });
  await skipOccurrence(COMPANY_ID, 'occ-1', 'u_priya', NOW);
  assert.deepEqual(calls, ['DELETE /bots/scheduled/sched-1']);
  assert.equal((updates[0].$set as { status: string }).status, 'skipped');
  assert.deepEqual(updates[1], { $set: { botDirty: false }, $unset: { bot: 1 } });
});

test('Skip is refused this close to the start, when MeetingBaas has the bot locked', async (t) => {
  const { updates, calls } = fake(t, { start: new Date(NOW.getTime() + 4 * MIN), bot: BOT });
  await assert.rejects(skipOccurrence(COMPANY_ID, 'occ-1', 'u_priya', NOW), (error: unknown) => {
    assert.ok(error instanceof ConflictError);
    assert.match(error.message, /already on its way/);
    return true;
  });
  assert.deepEqual(calls, []);
  assert.deepEqual(updates, []);
});

test('if MeetingBaas refuses the cancel, the occurrence goes back and the person is told', async (t) => {
  const { updates } = fake(t, { start: new Date(NOW.getTime() + 60 * MIN), bot: BOT }, 409);
  await assert.rejects(skipOccurrence(COMPANY_ID, 'occ-1', 'u_priya', NOW), ConflictError);
  assert.deepEqual(updates.at(-1), { $set: { status: 'scheduled' }, $unset: { skipReason: 1, skippedByUserId: 1 } });
});

test('an occurrence without a bot, or waiting for approval, is simply skipped', async (t) => {
  const { updates, calls } = fake(t, { status: 'needs_approval', start: new Date(NOW.getTime() + 2 * MIN) });
  await skipOccurrence(COMPANY_ID, 'occ-1', 'u_priya', NOW);
  assert.deepEqual(calls, []);
  assert.equal((updates[0].$set as { status: string; skipReason: string }).skipReason, 'person');
});

test('Taro on its way already, or a canceled meeting, cannot be skipped', async (t) => {
  fake(t, { status: 'launched', start: new Date(NOW.getTime() + 2 * MIN) });
  await assert.rejects(skipOccurrence(COMPANY_ID, 'occ-1', 'u_priya', NOW), /already on its way/);
  t.mock.restoreAll();
  fake(t, { status: 'canceled', start: new Date(NOW.getTime() + 60 * MIN) });
  await assert.rejects(skipOccurrence(COMPANY_ID, 'occ-1', 'u_priya', NOW), /was canceled/);
});

test("a meeting from someone's Google Calendar is in their own Upcoming, and only they can skip it", async (t) => {
  const at = (minutes: number) => new Date(NOW.getTime() + minutes * MIN);
  const row = (fields: Record<string, unknown>) => ({
    companyId: COMPANY_ID,
    recurrenceKey: '',
    meetUrl: 'https://meet.google.com/kdp-wqmx-tvr',
    platform: 'google_meet',
    status: 'scheduled',
    botRev: 1,
    ...fields,
  });
  const occurrences = useMemory(
    t,
    CalendarOccurrenceModel,
    memoryModel([
      row({ uid: 'g:one-on-one', source: 'google', holders: ['u_priya'], title: 'Priya and Maya', start: at(60), end: at(90) }),
      row({ uid: 'vendor@outlook.com', seriesId: 'series-1', title: 'Vendor review', start: at(120), end: at(150) }),
      row({ uid: 'g:elsewhere', source: 'google', holders: ['u_priya'], title: 'Another workspace', start: at(60), end: at(90), companyId: '6a1f00000000000000000009' }),
    ])
  );
  t.mock.method(CompanyModel, 'findById', (async () => ({ _id: COMPANY_ID, providers: {} })) as never);
  const oneOnOne = String(occurrences.docs[0]._id);

  const sams = await upcomingFor(COMPANY_ID, 'u_sam', NOW);
  assert.deepEqual(sams.map((m) => m.title), ['Vendor review']);
  const priyas = await upcomingFor(COMPANY_ID, 'u_priya', NOW);
  assert.deepEqual(priyas.map((m) => [m.title, m.source]), [['Priya and Maya', 'google'], ['Vendor review', 'invite']]);
  // A workspace that isn't ready says why, for these as for invitations
  assert.match(priyas[0].problem ?? '', /isn't set up yet/);

  await assert.rejects(skipOccurrence(COMPANY_ID, oneOnOne, 'u_sam', NOW), NotFoundError);
  await skipOccurrence(COMPANY_ID, oneOnOne, 'u_priya', NOW);
  assert.equal(occurrences.docs[0].status, 'skipped');
  await assert.rejects(restoreOccurrence(COMPANY_ID, oneOnOne, 'u_sam', NOW), NotFoundError);
  await restoreOccurrence(COMPANY_ID, oneOnOne, 'u_priya', NOW);
  assert.equal(occurrences.docs[0].status, 'scheduled');
  // Her own calendar vouched for it, so there's nothing to approve
  await assert.rejects(decideOccurrence(COMPANY_ID, oneOnOne, 'approve', { userId: 'u_priya' }, NOW), ConflictError);
  for (let i = 0; i < 50; i++) await new Promise((resolve) => setImmediate(resolve));
});
