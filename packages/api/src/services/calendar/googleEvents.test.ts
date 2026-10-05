import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sha256 } from '../../lib/crypto';
import { meetingsFromEvents, readEvent, type GoogleMeeting } from './googleEvents';

const MIN = 60_000;
const NOW = new Date('2026-10-07T17:00:00Z');
const WEEK = { from: new Date(NOW.getTime() - 10 * MIN), to: new Date(NOW.getTime() + 7 * 24 * 60 * MIN) };

// The shape events.list returns with Taro's fields, as Google sends it.
function event(fields: Record<string, unknown> = {}) {
  return {
    id: 'evt1',
    iCalUID: 'evt1@google.com',
    status: 'confirmed',
    eventType: 'default',
    summary: 'Design review',
    start: { dateTime: '2026-10-07T10:00:00-07:00', timeZone: 'America/Los_Angeles' },
    end: { dateTime: '2026-10-07T10:30:00-07:00', timeZone: 'America/Los_Angeles' },
    hangoutLink: 'https://meet.google.com/kdp-wqmx-tvr',
    conferenceData: {
      entryPoints: [
        { entryPointType: 'video', uri: 'https://meet.google.com/kdp-wqmx-tvr' },
        { entryPointType: 'phone', uri: 'tel:+1-555-0100' },
      ],
    },
    organizer: { email: 'maya@northwind.dev' },
    attendees: [{ self: true, responseStatus: 'accepted' }],
    ...fields,
  };
}

function meeting(raw: unknown, mode: 'all' | 'organizer' = 'all'): GoogleMeeting {
  const result = readEvent(raw, mode);
  assert.ok('meeting' in result, `expected a meeting, got ${JSON.stringify(result)}`);
  return result.meeting;
}

const skip = (raw: unknown, mode: 'all' | 'organizer' = 'all') => {
  const result = readEvent(raw, mode);
  return 'skip' in result ? result.skip : null;
};

test('a Google Meet event becomes a meeting keyed by its iCalUID, with only what Taro keeps', () => {
  const m = meeting(event());
  assert.deepEqual(m, {
    uid: `g:${sha256('evt1@google.com')}`,
    recurrenceKey: '',
    recurring: false,
    start: new Date('2026-10-07T17:00:00Z'),
    end: new Date('2026-10-07T17:30:00Z'),
    title: 'Design review',
    meetUrl: 'https://meet.google.com/kdp-wqmx-tvr',
    platform: 'google_meet',
    organizerEmail: 'maya@northwind.dev',
  });
});

test('Zoom and Teams links come from the conference an add-on attached, then from the location and description', () => {
  const zoomAddOn = meeting(
    event({
      hangoutLink: undefined,
      conferenceData: { entryPoints: [{ entryPointType: 'video', uri: 'https://us02web.zoom.us/j/81234567890?pwd=abc123' }] },
    })
  );
  assert.equal(zoomAddOn.platform, 'zoom');
  assert.equal(zoomAddOn.meetUrl, 'https://us02web.zoom.us/j/81234567890?pwd=abc123');

  const zoomTyped = meeting(event({ hangoutLink: undefined, conferenceData: undefined, location: 'Zoom: https://acme.zoom.us/j/99887766554' }));
  assert.equal(zoomTyped.meetUrl, 'https://acme.zoom.us/j/99887766554');

  // Outlook's HTML invitation, as Google copies it into the description: an href, and entities hiding characters
  const teams = meeting(
    event({
      hangoutLink: undefined,
      conferenceData: undefined,
      location: 'Microsoft Teams Meeting',
      description:
        '<p>Join the meeting now</p><a href="https://teams.microsoft.com/l/meetup-join/19%3ameeting_NjQ%40thread.v2/0?context=%7b%22Tid%22%3a%22t1%22%7d">Click here</a>',
    })
  );
  assert.equal(teams.platform, 'teams');
  assert.match(teams.meetUrl, /^https:\/\/teams\.microsoft\.com\/l\/meetup-join\//);

  // A conference Taro can't join (no supported link) doesn't stop it finding Meet's own link
  const webexThenMeet = meeting(
    event({ conferenceData: { entryPoints: [{ entryPointType: 'video', uri: 'https://acme.webex.com/meet/pr123' }] } })
  );
  assert.equal(webexThenMeet.meetUrl, 'https://meet.google.com/kdp-wqmx-tvr');
});

test('declined, all-day, canceled, linkless, and non-meeting events are skipped', () => {
  assert.equal(skip(event({ attendees: [{ self: true, responseStatus: 'declined' }] })), 'declined');
  assert.equal(skip(event({ start: { date: '2026-10-07' }, end: { date: '2026-10-08' } })), 'all_day');
  assert.equal(skip(event({ status: 'cancelled' })), 'canceled');
  assert.equal(skip(event({ hangoutLink: undefined, conferenceData: undefined, location: 'Room 4B', description: 'Agenda in the doc' })), 'no_link');
  assert.equal(skip(event({ eventType: 'focusTime' })), 'not_a_meeting');
  assert.equal(skip(event({ eventType: 'outOfOffice' })), 'not_a_meeting');
  assert.equal(skip('not an event'), 'unreadable');
  assert.equal(skip(event({ start: { dateTime: 'soon' } })), 'unreadable');

  // Not answering yet, or maybe, still counts: only a decline keeps Taro away
  assert.ok(meeting(event({ attendees: [{ self: true, responseStatus: 'needsAction' }] })));
  assert.ok(meeting(event({ attendees: [{ self: true, responseStatus: 'tentative' }] })));
  // Someone else declining says nothing about this person
  assert.ok(meeting(event({ attendees: [{ responseStatus: 'declined' }] })));
});

test('"Only meetings I organize" keeps just the events the person organizes', () => {
  const mine = event({ organizer: { email: 'priya@northwind.dev', self: true }, attendeesOmitted: true });
  const theirs = event({ organizer: { email: 'maya@northwind.dev' } });
  assert.ok(meeting(mine, 'organizer'));
  assert.equal(skip(theirs, 'organizer'), 'not_organizer');
  // The default joins both
  assert.ok(meeting(mine, 'all'));
  assert.ok(meeting(theirs, 'all'));
});

test('occurrences of a recurring meeting share its UID and are keyed by their original start, even after one moves', () => {
  const instance = (day: string, moved?: string) =>
    event({
      id: `standup_${day.replace(/-/g, '')}T160000Z`,
      iCalUID: 'standup@google.com',
      recurringEventId: 'standup',
      summary: 'Standup',
      originalStartTime: { dateTime: `${day}T09:00:00-07:00`, timeZone: 'America/Los_Angeles' },
      start: { dateTime: moved ?? `${day}T09:00:00-07:00` },
      end: { dateTime: moved ? moved.replace('T11:00', 'T11:15') : `${day}T09:15:00-07:00` },
    });

  const tuesday = meeting(instance('2026-10-06'));
  const wednesday = meeting(instance('2026-10-07'));
  assert.equal(tuesday.uid, wednesday.uid);
  assert.equal(tuesday.recurring, true);
  assert.equal(tuesday.recurrenceKey, '2026-10-06T16:00:00.000Z');
  assert.equal(wednesday.recurrenceKey, '2026-10-07T16:00:00.000Z');

  // Wednesday's standup moves to 11: same occurrence, new time
  const moved = meeting(instance('2026-10-07', '2026-10-07T11:00:00-07:00'));
  assert.equal(moved.uid, wednesday.uid);
  assert.equal(moved.recurrenceKey, wednesday.recurrenceKey);
  assert.deepEqual(moved.start, new Date('2026-10-07T18:00:00Z'));
});

test("the same meeting on two members' calendars gets the same key, whatever each calendar's time zone", () => {
  const onPriyas = event({
    id: 'a1b2c3_20261007T170000Z',
    iCalUID: '040000008200E00074C5B7101A82E00800000000@outlook.com',
    recurringEventId: 'a1b2c3',
    originalStartTime: { dateTime: '2026-10-07T10:00:00-07:00', timeZone: 'America/Los_Angeles' },
  });
  const onSams = event({
    id: 'z9y8x7_20261007T170000Z',
    iCalUID: '040000008200E00074C5B7101A82E00800000000@outlook.com',
    recurringEventId: 'z9y8x7',
    originalStartTime: { dateTime: '2026-10-07T13:00:00-04:00', timeZone: 'America/New_York' },
    start: { dateTime: '2026-10-07T13:00:00-04:00' },
    end: { dateTime: '2026-10-07T13:30:00-04:00' },
  });
  const a = meeting(onPriyas);
  const b = meeting(onSams);
  assert.equal(a.uid, b.uid);
  assert.equal(a.recurrenceKey, b.recurrenceKey);
  assert.deepEqual(a.start, b.start);
});

test('event text is treated as untrusted: titles cleaned and capped, odd organizers dropped, durations bounded', () => {
  const m = meeting(
    event({
      summary: `Plan\u0000ning‮  ${'x'.repeat(500)}`,
      organizer: { email: 'not an address' },
      end: { dateTime: '2026-10-09T10:00:00-07:00' },
    })
  );
  assert.equal(m.title!.length, 200);
  assert.ok(m.title!.startsWith('Plan ning x'));
  assert.equal(m.organizerEmail, undefined);
  // A meeting that claims to run two days is held to one
  assert.equal(m.end.getTime() - m.start.getTime(), 24 * 60 * MIN);
  // An end before the start reads as half an hour
  const backwards = meeting(event({ end: { dateTime: '2026-10-07T09:00:00-07:00' } }));
  assert.equal(backwards.end.getTime() - backwards.start.getTime(), 30 * MIN);
});

test('the window keeps meetings from 10 minutes ago to a week ahead, once each, soonest first', () => {
  const at = (iso: string, id: string) => event({ id, iCalUID: `${id}@google.com`, start: { dateTime: iso }, end: { dateTime: iso.replace(':00Z', ':30Z') } });
  const { meetings, skipped } = meetingsFromEvents(
    [
      at('2026-10-08T15:00:00Z', 'tomorrow'),
      at('2026-10-07T16:55:00Z', 'five-late'),
      at('2026-10-07T16:40:00Z', 'twenty-late'),
      at('2026-10-15T15:00:00Z', 'next-week'),
      at('2026-10-08T15:00:00Z', 'tomorrow'),
      event({ id: 'all-day', start: { date: '2026-10-08' }, end: { date: '2026-10-09' } }),
    ],
    'all',
    WEEK
  );
  assert.deepEqual(
    meetings.map((m) => m.uid),
    [`g:${sha256('five-late@google.com')}`, `g:${sha256('tomorrow@google.com')}`]
  );
  assert.deepEqual(skipped, { all_day: 1 });
});

test('an event with nobody else on it is not a meeting, even with a link', () => {
  const solo = { organizer: { email: 'priya@northwind.dev', self: true }, attendees: [{ self: true, responseStatus: 'accepted' }] };
  assert.equal(skip(event(solo)), 'no_guests');
  assert.equal(skip(event({ ...solo, attendees: undefined })), 'no_guests');
  // Guests Google left out of the reply, or someone else organizing it, make it a meeting
  assert.ok(meeting(event({ ...solo, attendeesOmitted: true })));
  assert.ok(meeting(event({ organizer: { email: 'maya@northwind.dev' } })));
});
