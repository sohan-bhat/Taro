import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { MeetingDoc } from '../db/models/Meeting';
import { listMeeting, publicMeeting } from './views';

const meeting = (status: MeetingDoc['status']) => ({
  _id: 'm1',
  companyId: 'c1',
  meetUrl: 'https://meet.google.com/abc-defg-hij',
  status,
  secretHash: 'never sent',
  transcript: 'The whole meeting, word for word.',
  liveTranscript: 'The last few minutes.',
  createdAt: new Date('2026-10-01T15:00:00Z'),
  updatedAt: new Date('2026-10-01T16:00:00Z'),
});

test('the meetings list leaves out full transcripts', () => {
  for (const status of ['pending', 'joining', 'active', 'ended', 'error'] as const) {
    assert.equal(listMeeting(meeting(status)).transcript, undefined, status);
  }
});

test('only live meetings keep their running text in the list', () => {
  for (const status of ['pending', 'joining', 'active'] as const) {
    assert.equal(listMeeting(meeting(status)).liveTranscript, 'The last few minutes.', status);
  }
  for (const status of ['ended', 'error'] as const) {
    assert.equal(listMeeting(meeting(status)).liveTranscript, undefined, status);
  }
});

test("a meeting's own view keeps both, and never the secret", () => {
  const view = publicMeeting(meeting('ended'));
  assert.equal(view.transcript, 'The whole meeting, word for word.');
  assert.equal(view.liveTranscript, 'The last few minutes.');
  assert.equal('secretHash' in view, false);
});
