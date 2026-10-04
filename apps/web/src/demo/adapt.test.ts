import assert from 'node:assert/strict';
import { test } from 'node:test';
import { meetingDuration } from '../lib/meeting-state';
import { describeRequest } from '../lib/requests';
import { adaptSnapshot, demo, MAX_DURATION_MS, summarize } from './adapt';
import type { DemoLog, DemoMeeting, DemoSnapshot } from './types';

const meeting = (id: string, createdAt: string, extra: Partial<DemoMeeting> = {}): DemoMeeting => ({
  _id: id,
  companyId: 'c1',
  meetUrl: `https://meet.google.com/${id}`,
  status: 'ended',
  createdAt,
  updatedAt: createdAt,
  ...extra,
});

const log = (id: string, status: string, extra: Partial<DemoLog> = {}): DemoLog => ({
  _id: id,
  command: 'post hello in general',
  intent: { action: 'post_message', params: { channel: 'general', message: 'Hello.' } },
  status,
  result: status === 'success' ? 'Posted "Hello." to #general' : undefined,
  createdAt: '2026-09-01T17:00:00.000Z',
  ...extra,
});

function snapshotOf(meetings: DemoMeeting[], logs: Record<string, DemoLog[]>, extra: Partial<DemoSnapshot> = {}): DemoSnapshot {
  return {
    capturedAt: '2026-09-02T18:00:00.000Z',
    company: { _id: 'c1', name: 'Acme', domain: 'acme', createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z' },
    slack: { connected: true, teamName: 'Acme' },
    github: { connected: true, configured: true, accountLogin: 'acme', repo: 'acme/web', enabledActions: ['create_github_issue'] },
    meetings,
    details: Object.fromEntries(meetings.map((m) => [m._id, { ...m, actionLogs: logs[m._id] ?? [] }])),
    ...extra,
  };
}

test('meetings with neither text nor requests are left out', () => {
  const adapted = adaptSnapshot(
    snapshotOf(
      [
        meeting('heard', '2026-09-01T16:00:00.000Z', { transcript: 'We talked.' }),
        meeting('asked', '2026-09-01T15:00:00.000Z'),
        meeting('silent', '2026-09-01T14:00:00.000Z', { transcript: '   ' }),
        meeting('never', '2026-09-01T13:00:00.000Z', { status: 'error' }),
      ],
      { asked: [log('l1', 'success')] }
    )
  );
  assert.deepEqual(
    adapted.meetings.map((m) => m._id),
    ['heard', 'asked']
  );
});

test('the featured meeting, else the most recent one with a done request', () => {
  const meetings = [
    meeting('newest', '2026-09-01T16:00:00.000Z', { transcript: 'Nothing asked.' }),
    meeting('done', '2026-09-01T15:00:00.000Z'),
    meeting('older', '2026-09-01T14:00:00.000Z'),
  ];
  const logs = { done: [log('l1', 'success')], older: [log('l2', 'success')] };
  assert.equal(adaptSnapshot(snapshotOf(meetings, logs)).featuredId, 'done');
  assert.equal(adaptSnapshot(snapshotOf(meetings, logs, { featuredMeetingId: 'older' })).featuredId, 'older');
  // A featured meeting the adapter dropped falls back to the rule
  assert.equal(adaptSnapshot(snapshotOf(meetings, logs, { featuredMeetingId: 'gone' })).featuredId, 'done');
});

test('tallies are counted from the requests, with turned off read from the workspace settings', () => {
  const adapted = adaptSnapshot(
    snapshotOf([meeting('m1', '2026-09-01T16:00:00.000Z')], {
      m1: [
        log('l1', 'success'),
        log('l2', 'failed', { errorMessage: 'Channel "x" not found' }),
        log('l3', 'clarification_needed', { intent: { action: 'merge_pull_request', params: { issueNumber: 3 } } }),
        log('l4', 'clarification_needed', { intent: { action: 'unknown', params: {} } }),
      ],
    })
  );
  assert.deepEqual(adapted.meetings[0].tally, { done: 1, needsYou: 1, turnedOff: 1, failed: 1 });
  assert.equal(adapted.summary, "Taro joined 1 meeting here and heard 4 requests. It did 1 of them, and for the other 3 it asked a question back or said why it couldn't.");
});

test('the summary sentence', () => {
  assert.equal(
    summarize(3, 9, 7),
    "Taro joined 3 meetings here and heard 9 requests. It did 7 of them, and for the other 2 it asked a question back or said why it couldn't."
  );
  assert.equal(summarize(2, 4, 4), 'Taro joined 2 meetings here and heard 4 requests. It did 4 of them.');
  assert.equal(summarize(1, 0, 0), 'Taro joined 1 meeting here.');
});

test('a Slack team domain reads like the dashboard; an older web domain as is', () => {
  assert.equal(adaptSnapshot(snapshotOf([], {})).domain, 'acme.slack.com');
  const old = snapshotOf([], {});
  old.company = { ...old.company, domain: 'acme.com' };
  assert.equal(adaptSnapshot(old).domain, 'acme.com');
});

test('the saved snapshot: dates in its zone, long runs without a duration, and real GitHub links', () => {
  assert.equal(demo.timeZone, 'America/Los_Angeles');
  assert.equal(demo.savedOn, 'August 29, 2026');
  assert.equal(demo.zoneName, 'Pacific');
  assert.ok(demo.featuredId && demo.details[demo.featuredId]);
  for (const m of demo.meetings) {
    assert.ok(m.status === 'ended' || m.status === 'error', 'nothing on the demo is live');
    const ms = m.endedAt ? Date.parse(m.endedAt) - Date.parse(m.startedAt ?? m.createdAt) : 0;
    if (ms > MAX_DURATION_MS) assert.equal(meetingDuration(m, MAX_DURATION_MS), undefined);
  }
  const links = Object.values(demo.details)
    .flatMap((d) => d.actionLogs.map((l) => describeRequest(l, { enabledActions: demo.setup.github.enabledActions }).link))
    .filter((link) => link !== undefined);
  assert.ok(links.length > 0);
  for (const link of links) assert.match(link.href, /^https:\/\/github\.com\/sohan-bhat\/VacantCourt\/(issues|pull)\/\d+$/);
});
