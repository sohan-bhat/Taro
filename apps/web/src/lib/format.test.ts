import assert from 'node:assert/strict';
import { test } from 'node:test';
import { formatUpcoming, meetingTitle, whoAndWhere } from './format';

// Monday, October 5, 2026, 9:00 AM in Los Angeles
const NOW = Date.parse('2026-10-05T16:00:00Z');
const LA = { timeZone: 'America/Los_Angeles', now: NOW };

test('upcoming meetings read as today, tomorrow, a weekday, then a date', () => {
  assert.equal(formatUpcoming('2026-10-05T21:00:00Z', LA), 'Today at 2:00 PM');
  assert.equal(formatUpcoming('2026-10-06T17:00:00Z', LA), 'Tomorrow at 10:00 AM');
  assert.equal(formatUpcoming('2026-10-08T16:00:00Z', LA), 'Thursday at 9:00 AM');
  assert.equal(formatUpcoming('2026-10-12T16:00:00Z', LA), 'Oct 12 at 9:00 AM');
  // A meeting that started a few minutes ago is still today.
  assert.equal(formatUpcoming('2026-10-05T15:55:00Z', LA), 'Today at 8:55 AM');
});

test('a calendar meeting is titled by its event and comes from the calendar', () => {
  const meeting = {
    meetUrl: 'https://meet.google.com/kdp-wqmx-tvr',
    platform: 'google_meet' as const,
    title: 'Export fix review',
    source: 'calendar' as const,
    startedByName: 'Maya Chen',
    createdAt: '2026-10-05T16:00:00Z',
  };
  assert.deepEqual(meetingTitle(meeting), { title: 'Export fix review', code: 'kdp-wqmx-tvr' });
  assert.equal(whoAndWhere(meeting), 'Maya, from the calendar');
  assert.equal(whoAndWhere({ ...meeting, startedByName: undefined }), 'From the calendar');
});
