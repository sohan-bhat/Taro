import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import path from 'path';
import { parseCalendar, type ParsedCalendar } from './ics';
import {
  applyMessage,
  botFits,
  CONFIRM_LEAD_MS,
  desiredOccurrences,
  dueFilter,
  IMMEDIATE_LEAD_MS,
  lateFilter,
  launchAtFor,
  planBot,
  planLaunch,
  planOccurrences,
  type SeriesState,
  type Sponsor,
} from './series';

const MIN = 60_000;
const DAY = 24 * 60 * MIN;
const NOW = new Date('2026-10-05T16:00:00Z');
const WINDOW = { from: new Date(NOW.getTime() - 10 * MIN), to: new Date(NOW.getTime() + 14 * DAY) };
const MAYA: Sponsor = { name: 'Maya Chen', userId: 'u_maya' };

const calendar = (name: string): ParsedCalendar => parseCalendar(fs.readFileSync(path.join(__dirname, 'fixtures', name), 'utf8'))!;
const iso = (d?: Date) => d?.toISOString();

function receive(state: SeriesState | null, name: string, sponsor: Sponsor | null = MAYA, now = NOW) {
  const parsed = calendar(name);
  return applyMessage(state, { method: parsed.method, events: parsed.events, sponsor }, now);
}

function occurrences(state: SeriesState) {
  return desiredOccurrences(state, WINDOW.from, WINDOW.to).desired.map((d) => ({ key: d.recurrenceKey, start: iso(d.start), title: d.title }));
}

test('an invitation from a member is approved; one from anyone else waits for approval', () => {
  const fromMaya = receive(null, 'google-single.ics', MAYA)!;
  assert.equal(fromMaya.state.approval, 'approved');
  assert.equal(fromMaya.state.sponsorName, 'Maya Chen');
  const fromStranger = receive(null, 'google-single.ics', null)!;
  assert.equal(fromStranger.state.approval, 'pending');
  assert.equal(fromStranger.state.sponsorName, undefined);
});

test('a one-off event becomes one occurrence with its link and title', () => {
  const { state } = receive(null, 'google-single.ics')!;
  const { desired } = desiredOccurrences(state, WINDOW.from, WINDOW.to);
  assert.deepEqual(desired, [
    {
      recurrenceKey: '',
      recurring: false,
      start: new Date('2026-10-07T21:00:00Z'),
      end: new Date('2026-10-07T21:30:00Z'),
      title: 'Export fix review',
      meetUrl: 'https://meet.google.com/kdp-wqmx-tvr',
      platform: 'google_meet',
    },
  ]);
});

test('an update with a higher SEQUENCE moves the meeting; an older copy arriving late changes nothing', () => {
  const first = receive(null, 'google-single.ics')!;
  const moved = receive(first.state, 'google-single-moved.ics')!;
  assert.ok(moved.changed);
  assert.equal(iso(moved.state.start), '2026-10-07T22:00:00.000Z');
  assert.equal(moved.state.sequence, 1);

  const stale = receive(moved.state, 'google-single.ics')!;
  assert.equal(stale.changed, false);
  assert.equal(iso(stale.state.start), '2026-10-07T22:00:00.000Z');

  // Same SEQUENCE, older DTSTAMP: also stale.
  const parsed = calendar('google-single-moved.ics');
  const older = { ...parsed.events[0], start: new Date('2026-10-07T23:00:00Z'), stamp: new Date('2026-10-01T00:00:00Z') };
  const sameSequence = applyMessage(moved.state, { method: 'request', events: [older], sponsor: MAYA }, NOW)!;
  assert.equal(sameSequence.changed, false);
});

test('a recurring series with a moved occurrence, a deleted one, and a canceled one', () => {
  const series = receive(null, 'google-weekly.ics')!;
  assert.deepEqual(occurrences(series.state), [
    { key: '2026-10-06T17:00:00.000Z', start: '2026-10-06T17:00:00.000Z', title: 'Platform sync' },
    // The Tuesday moved an hour later, keyed by its original start.
    { key: '2026-10-13T17:00:00.000Z', start: '2026-10-13T18:00:00.000Z', title: 'Platform sync (moved)' },
    { key: '2026-10-15T17:00:00.000Z', start: '2026-10-15T17:00:00.000Z', title: 'Platform sync' },
  ]);

  const canceled = receive(series.state, 'google-cancel-occurrence.ics')!;
  assert.ok(canceled.changed);
  assert.deepEqual(
    occurrences(canceled.state).map((o) => o.key),
    ['2026-10-06T17:00:00.000Z', '2026-10-13T17:00:00.000Z']
  );
  // The window moves on: two weeks later, later occurrences appear.
  const later = desiredOccurrences(canceled.state, new Date('2026-10-18T00:00:00Z'), new Date('2026-11-01T00:00:00Z')).desired;
  assert.deepEqual(
    later.map((d) => iso(d.start)),
    ['2026-10-20T17:00:00.000Z', '2026-10-22T17:00:00.000Z', '2026-10-27T17:00:00.000Z', '2026-10-29T17:00:00.000Z']
  );
});

test('a CANCEL for the series removes every occurrence; an older one is ignored', () => {
  const series = receive(null, 'google-weekly.ics')!;
  const gone = receive(series.state, 'google-cancel-series.ics')!;
  assert.ok(gone.state.canceledAt);
  assert.deepEqual(occurrences(gone.state), []);

  const newer = { ...series.state, sequence: 5 };
  const stale = receive(newer, 'google-cancel-series.ics')!;
  assert.equal(stale.state.canceledAt, undefined);
  assert.equal(stale.changed, false);
});

test("a cancellation for a meeting Taro never had is nothing to store", () => {
  assert.equal(receive(null, 'google-cancel-series.ics'), null);
  assert.equal(receive(null, 'google-cancel-occurrence.ics'), null);
});

test('when the whole series moves, changes to single occurrences are dropped, as calendars do', () => {
  const series = receive(null, 'google-weekly.ics')!;
  assert.equal(series.state.overrides.length, 1);
  const parsed = calendar('google-weekly.ics');
  const master = parsed.events[0];
  const later = {
    ...master,
    sequence: 3,
    schedule: master.schedule!.replace(/T100000/g, 'T120000').replace(/T103000/g, 'T123000'),
  };
  const moved = applyMessage(series.state, { method: 'request', events: [later], sponsor: MAYA }, NOW)!;
  assert.equal(moved.state.overrides.length, 0);
  assert.equal(occurrences(moved.state)[0].start, '2026-10-06T19:00:00.000Z');
});

test('mail nobody vouched for cannot move or relink an approved meeting on its own', () => {
  const approved = receive(null, 'google-single.ics', MAYA)!.state;
  const moved = receive(approved, 'google-single-moved.ics', null)!;
  assert.equal(moved.reapprove, true);
  assert.equal(moved.state.approval, 'pending');

  const parsed = calendar('google-single.ics');
  const relinked = { ...parsed.events[0], sequence: 1, link: { url: 'https://zoom.us/j/99887766554', platform: 'zoom' as const } };
  const hijack = applyMessage(approved, { method: 'request', events: [relinked], sponsor: null }, NOW)!;
  assert.equal(hijack.state.approval, 'pending');

  // The same change from a member keeps it approved.
  const fromMember = receive(approved, 'google-single-moved.ics', MAYA)!;
  assert.equal(fromMember.state.approval, 'approved');
  assert.equal(fromMember.reapprove, false);
});

test('anyone may cancel: a cancellation never needs approval', () => {
  const approved = receive(null, 'google-weekly.ics', MAYA)!.state;
  const canceled = receive(approved, 'google-cancel-occurrence.ics', null)!;
  assert.equal(canceled.state.approval, 'approved');
  assert.equal(canceled.reapprove, false);
});

test('a member vouching later approves a meeting that was waiting', () => {
  const waiting = receive(null, 'google-single.ics', null)!.state;
  const vouched = receive(waiting, 'google-single.ics', { name: 'Priya Raman', userId: 'u_priya' })!;
  assert.equal(vouched.state.approval, 'approved');
  assert.equal(vouched.state.sponsorName, 'Priya Raman');
});

test('stored occurrences follow the series: a Skip stands, a joined one stays joined', () => {
  const { state } = receive(null, 'google-weekly.ics')!;
  const { desired } = desiredOccurrences(state, WINDOW.from, WINDOW.to);
  const changes = planOccurrences(
    [
      { recurrenceKey: '2026-10-06T17:00:00.000Z', status: 'launched', start: new Date('2026-10-06T17:00:00Z') },
      { recurrenceKey: '2026-10-13T17:00:00.000Z', status: 'skipped', skipReason: 'person', start: new Date('2026-10-13T17:00:00Z') },
      { recurrenceKey: '2026-10-08T17:00:00.000Z', status: 'scheduled', start: new Date('2026-10-08T17:00:00Z') },
    ],
    desired,
    'approved',
    NOW
  );
  const byKey = Object.fromEntries(changes.map((c) => [c.kind === 'cancel' ? c.recurrenceKey : c.desired.recurrenceKey, c]));
  assert.equal((byKey['2026-10-06T17:00:00.000Z'] as { status: string }).status, 'launched');
  assert.equal((byKey['2026-10-13T17:00:00.000Z'] as { status: string }).status, 'skipped');
  assert.equal((byKey['2026-10-15T17:00:00.000Z'] as { status: string }).status, 'scheduled');
  // Not in the series anymore (the deleted Thursday): canceled.
  assert.equal(byKey['2026-10-08T17:00:00.000Z'].kind, 'cancel');
});

test('waiting and declined series give their occurrences the matching status', () => {
  const { state } = receive(null, 'google-single.ics', null)!;
  const { desired } = desiredOccurrences(state, WINDOW.from, WINDOW.to);
  const pending = planOccurrences([], desired, 'pending', NOW);
  assert.equal(pending[0].kind === 'upsert' && pending[0].status, 'needs_approval');
  const declined = planOccurrences(
    [{ recurrenceKey: '', status: 'skipped', skipReason: 'person', start: desired[0].start }],
    desired,
    'declined',
    NOW
  );
  assert.equal(declined[0].kind === 'upsert' && declined[0].status, 'canceled');
});

test('a meeting moved to a later time after Taro went is a new occurrence', () => {
  const { state } = receive(null, 'google-single-moved.ics')!;
  const { desired } = desiredOccurrences(state, WINDOW.from, WINDOW.to);
  const [change] = planOccurrences([{ recurrenceKey: '', status: 'launched', start: new Date('2026-10-07T21:00:00Z') }], desired, 'approved', NOW);
  assert.ok(change.kind === 'upsert' && change.relaunch && change.status === 'scheduled');
});

// -------------------------------------------------------------------------------------------
// Bots and launches

const START = new Date('2026-10-07T21:00:00Z');
const MEET = 'https://meet.google.com/kdp-wqmx-tvr';
const at = (msBeforeStart: number) => new Date(START.getTime() - msBeforeStart);

test('a scheduled occurrence in a ready workspace gets a bot that joins at the start', () => {
  assert.deepEqual(planBot({ status: 'scheduled', start: START, meetUrl: MEET }, true, NOW), { kind: 'create', joinAt: START });
  const bot = { joinAt: START, meetUrl: MEET };
  assert.deepEqual(planBot({ status: 'scheduled', start: START, meetUrl: MEET, bot }, true, NOW), { kind: 'none' });
});

test('a workspace that is not ready schedules nothing, and lets go of what it had', () => {
  assert.deepEqual(planBot({ status: 'scheduled', start: START, meetUrl: MEET }, false, NOW), { kind: 'none' });
  const bot = { joinAt: START, meetUrl: MEET };
  assert.deepEqual(planBot({ status: 'scheduled', start: START, meetUrl: MEET, bot }, false, NOW), { kind: 'release' });
});

test('skipped, waiting, and canceled occurrences let go of their bot', () => {
  const bot = { joinAt: START, meetUrl: MEET };
  for (const status of ['skipped', 'needs_approval', 'canceled'] as const) {
    assert.deepEqual(planBot({ status, start: START, meetUrl: MEET, bot }, true, NOW), { kind: 'release' }, status);
    assert.deepEqual(planBot({ status, start: START, meetUrl: MEET }, true, NOW), { kind: 'none' }, status);
  }
});

test('a moved or relinked meeting moves its bot, unless it is too close to the start', () => {
  const bot = { joinAt: START, meetUrl: MEET };
  const later = new Date(START.getTime() + 60 * MIN);
  assert.deepEqual(planBot({ status: 'scheduled', start: later, meetUrl: MEET, bot }, true, NOW), { kind: 'move', joinAt: later, meetUrl: MEET });
  const zoom = 'https://zoom.us/j/99887766554';
  assert.deepEqual(planBot({ status: 'scheduled', start: START, meetUrl: zoom, bot }, true, NOW), { kind: 'move', joinAt: START, meetUrl: zoom });
  // Three minutes out, MeetingBaas won't move it; Taro sends a bot itself at the start instead.
  assert.deepEqual(planBot({ status: 'scheduled', start: START, meetUrl: zoom, bot }, true, at(3 * MIN)), { kind: 'release' });
  assert.deepEqual(planBot({ status: 'scheduled', start: START, meetUrl: MEET }, true, at(3 * MIN)), { kind: 'none' });
});

test('a meeting months away waits until MeetingBaas will take it', () => {
  const far = new Date(NOW.getTime() + 120 * DAY);
  const plan = planBot({ status: 'scheduled', start: far, meetUrl: MEET }, true, NOW);
  assert.equal(plan.kind, 'later');
  assert.ok(plan.kind === 'later' && plan.at.getTime() > NOW.getTime() && plan.at.getTime() < far.getTime());
});

test('Taro takes an occurrence five minutes ahead to confirm its bot, or a minute ahead to send one', () => {
  const bot = { joinAt: START, meetUrl: MEET };
  assert.equal(launchAtFor(START, MEET, bot).getTime(), START.getTime() - CONFIRM_LEAD_MS);
  assert.equal(launchAtFor(START, MEET).getTime(), START.getTime() - IMMEDIATE_LEAD_MS);
  // A bot for another time or link doesn't count.
  assert.equal(launchAtFor(START, 'https://zoom.us/j/1', bot).getTime(), START.getTime() - IMMEDIATE_LEAD_MS);
  assert.ok(botFits(bot, START, MEET));
  assert.ok(!botFits(bot, new Date(START.getTime() + 2 * MIN), MEET));
});

test('at launch: confirm a bot still coming; otherwise send one, but not before a minute ahead', () => {
  const bot = { joinAt: START, meetUrl: MEET };
  assert.deepEqual(planLaunch({ start: START, meetUrl: MEET, bot }, 'ok', at(5 * MIN)), { kind: 'confirm' });
  assert.deepEqual(planLaunch({ start: START, meetUrl: MEET, bot }, 'unknown', at(5 * MIN)), { kind: 'confirm' });
  assert.deepEqual(planLaunch({ start: START, meetUrl: MEET, bot }, 'gone', at(5 * MIN)), { kind: 'wait', until: at(MIN) });
  assert.deepEqual(planLaunch({ start: START, meetUrl: MEET }, 'unknown', at(MIN)), { kind: 'immediate' });
  assert.deepEqual(planLaunch({ start: START, meetUrl: MEET }, 'unknown', new Date(START.getTime() + 4 * MIN)), { kind: 'immediate' });
});

test('due and late: a scheduled occurrence is taken once its time comes, and never more than 10 minutes late', () => {
  const now = new Date('2026-10-07T21:00:00Z');
  assert.deepEqual(dueFilter(now), { status: 'scheduled', launchAt: { $lte: now }, start: { $gte: new Date('2026-10-07T20:50:00Z') } });
  assert.deepEqual(lateFilter(now), { status: 'scheduled', start: { $lt: new Date('2026-10-07T20:50:00Z') } });
});
