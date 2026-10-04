import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import path from 'path';
import { expandSchedule, parseCalendar, wallClockToUtc, type ParsedEvent } from './ics';

const fixture = (name: string) => fs.readFileSync(path.join(__dirname, 'fixtures', name), 'utf8');
const iso = (d?: Date) => d?.toISOString();

function only(name: string): ParsedEvent {
  const parsed = parseCalendar(fixture(name));
  assert.ok(parsed, name);
  assert.equal(parsed.events.length, 1, name);
  return parsed.events[0];
}

const ics = (...lines: string[]) => ['BEGIN:VCALENDAR', 'VERSION:2.0', ...lines, 'END:VCALENDAR'].join('\r\n');

test('a Google Calendar invitation: its time in the organizer zone, title, organizer, and Meet link', () => {
  const parsed = parseCalendar(fixture('google-single.ics'))!;
  assert.equal(parsed.method, 'request');
  const [event] = parsed.events;
  assert.equal(event.uid, '5n2k8q1v0m3c7b4x9z6a2d1f0g@google.com');
  assert.equal(event.sequence, 0);
  // 2:00 PM in Los Angeles on October 7 is daylight time, UTC-7.
  assert.equal(iso(event.start), '2026-10-07T21:00:00.000Z');
  assert.equal(iso(event.end), '2026-10-07T21:30:00.000Z');
  assert.equal(event.title, 'Export fix review');
  assert.deepEqual(event.organizer, { email: 'maya@northwind.dev', name: 'Maya Chen' });
  assert.deepEqual(event.link, { url: 'https://meet.google.com/kdp-wqmx-tvr', platform: 'google_meet' });
  assert.equal(event.schedule, undefined);
  assert.equal(event.canceled, false);
});

test('an Outlook Teams invitation: a Windows zone described in the invitation, and the Teams link', () => {
  const event = only('outlook-teams.ics');
  assert.equal(iso(event.start), '2026-10-08T16:00:00.000Z');
  assert.equal(iso(event.end), '2026-10-08T17:00:00.000Z');
  assert.equal(event.title, 'Vendor review');
  assert.equal(event.organizer?.email, 'daniel@northwind.dev');
  assert.equal(event.link?.platform, 'teams');
  assert.match(event.link!.url, /^https:\/\/teams\.microsoft\.com\/l\/meetup-join\/19%3ameeting_/);
  // The context keeps its tenant, which Teams needs to admit the bot.
  assert.match(event.link!.url, /context=%7b%22Tid%22/);
});

test('a Zoom link in LOCATION keeps its passcode', () => {
  const event = only('outlook-zoom.ics');
  assert.equal(iso(event.start), '2026-10-09T17:00:00.000Z');
  assert.deepEqual(event.link, { url: 'https://us02web.zoom.us/j/81234567890?pwd=bXlTZWNyZXRQYXNz.1', platform: 'zoom' });
});

test('a Meet link only in an HTML description, in a zone named but not described', () => {
  const event = only('meet-in-description.ics');
  // 9:00 AM in Berlin on October 12 is summer time, UTC+2.
  assert.equal(iso(event.start), '2026-10-12T07:00:00.000Z');
  assert.deepEqual(event.link, { url: 'https://meet.google.com/abc-defg-hij', platform: 'google_meet' });
  assert.deepEqual(event.organizer, { email: 'leo@northwind.dev', name: 'Leo Martins' });
});

test('a Meet link in a Zoom style description, a Teams link in a URL property, all found', () => {
  const zoomInDescription = parseCalendar(
    ics('METHOD:REQUEST', 'BEGIN:VEVENT', 'UID:a', 'DTSTART:20261010T150000Z', 'DESCRIPTION:Join: https://zoom.us/j/5551234567?pwd=abc. Thanks!', 'END:VEVENT')
  )!.events[0];
  assert.deepEqual(zoomInDescription.link, { url: 'https://zoom.us/j/5551234567?pwd=abc', platform: 'zoom' });
  const teamsInUrl = parseCalendar(
    ics('METHOD:REQUEST', 'BEGIN:VEVENT', 'UID:b', 'DTSTART:20261010T150000Z', 'URL:https://teams.microsoft.com/meet/287401551829?p=Xy7Pq2', 'END:VEVENT')
  )!.events[0];
  assert.deepEqual(teamsInUrl.link, { url: 'https://teams.microsoft.com/meet/287401551829?p=Xy7Pq2', platform: 'teams' });
  const meetInSummary = parseCalendar(
    ics('BEGIN:VEVENT', 'UID:c', 'DTSTART:20261010T150000Z', 'SUMMARY:Standup https://meet.google.com/xyz-abcd-efg', 'END:VEVENT')
  )!;
  // No METHOD at all: an event file someone sent on purpose, read like an invitation.
  assert.equal(meetInSummary.method, 'request');
  assert.deepEqual(meetInSummary.events[0].link, { url: 'https://meet.google.com/xyz-abcd-efg', platform: 'google_meet' });
  const noLink = parseCalendar(ics('BEGIN:VEVENT', 'UID:d', 'DTSTART:20261010T150000Z', 'LOCATION:Room 4', 'END:VEVENT'))!;
  assert.equal(noLink.events[0].link, undefined);
});

test('a recurring series: its schedule expands with deleted occurrences left out, across a clock change', () => {
  const parsed = parseCalendar(fixture('google-weekly.ics'))!;
  assert.equal(parsed.events.length, 2);
  const [master, moved] = parsed.events;
  assert.ok(master.schedule);
  assert.equal(master.recurrenceId, undefined);
  // Nothing personal goes into the stored schedule.
  assert.doesNotMatch(master.schedule!, /maya|ATTENDEE|DESCRIPTION|SUMMARY|meet\.google/i);

  assert.equal(iso(moved.recurrenceId), '2026-10-13T17:00:00.000Z');
  assert.equal(iso(moved.start), '2026-10-13T18:00:00.000Z');
  assert.equal(moved.sequence, 1);
  assert.equal(moved.title, 'Platform sync (moved)');

  const { times, finished } = expandSchedule(master.schedule!, new Date('2026-10-05T16:00:00Z'), new Date('2026-11-06T00:00:00Z'));
  assert.equal(finished, false);
  assert.deepEqual(
    times.map((t) => iso(t.start)),
    [
      '2026-10-06T17:00:00.000Z',
      // October 8 is an EXDATE.
      '2026-10-13T17:00:00.000Z',
      '2026-10-15T17:00:00.000Z',
      '2026-10-20T17:00:00.000Z',
      '2026-10-22T17:00:00.000Z',
      '2026-10-27T17:00:00.000Z',
      '2026-10-29T17:00:00.000Z',
      // Daylight time ended on November 1: 10:00 AM is now UTC-8.
      '2026-11-03T18:00:00.000Z',
      '2026-11-05T18:00:00.000Z',
    ]
  );
  assert.ok(times.every((t) => t.end.getTime() - t.start.getTime() === 30 * 60_000));
});

test('a series with an end stops, and COUNT is honored', () => {
  const schedule = parseCalendar(
    ics('BEGIN:VEVENT', 'UID:x', 'DTSTART:20261006T150000Z', 'DTEND:20261006T153000Z', 'RRULE:FREQ=DAILY;COUNT=3', 'SUMMARY:Daily', 'END:VEVENT')
  )!.events[0].schedule!;
  const { times, finished } = expandSchedule(schedule, new Date('2026-10-01T00:00:00Z'), new Date('2026-10-30T00:00:00Z'));
  assert.equal(times.length, 3);
  assert.equal(finished, true);
});

test('cancellations: one occurrence, and the whole series', () => {
  const one = parseCalendar(fixture('google-cancel-occurrence.ics'))!;
  assert.equal(one.method, 'cancel');
  assert.equal(iso(one.events[0].recurrenceId), '2026-10-15T17:00:00.000Z');
  assert.equal(one.events[0].canceled, true);
  const all = parseCalendar(fixture('google-cancel-series.ics'))!;
  assert.equal(all.method, 'cancel');
  assert.equal(all.events[0].recurrenceId, undefined);
  assert.equal(all.events[0].sequence, 2);
});

test('an update moves the time and carries a higher SEQUENCE', () => {
  const before = only('google-single.ics');
  const after = only('google-single-moved.ics');
  assert.equal(after.uid, before.uid);
  assert.equal(after.sequence, 1);
  assert.equal(iso(after.start), '2026-10-07T22:00:00.000Z');
  assert.ok(after.stamp! > before.stamp!);
});

test('replies, counters, broken text, and too much text are nothing for Taro', () => {
  assert.equal(parseCalendar(ics('METHOD:REPLY', 'BEGIN:VEVENT', 'UID:r', 'DTSTART:20261010T150000Z', 'END:VEVENT')), null);
  assert.equal(parseCalendar(ics('METHOD:COUNTER', 'BEGIN:VEVENT', 'UID:r', 'DTSTART:20261010T150000Z', 'END:VEVENT')), null);
  assert.equal(parseCalendar('not a calendar at all'), null);
  assert.equal(parseCalendar('BEGIN:VCARD\r\nVERSION:4.0\r\nEND:VCARD'), null);
  assert.equal(parseCalendar(''), null);
  assert.equal(parseCalendar(ics('BEGIN:VEVENT', 'UID:big', `DESCRIPTION:${'x'.repeat(600_000)}`, 'END:VEVENT')), null);
  // An event without a UID can't be matched to anything later.
  assert.deepEqual(parseCalendar(ics('BEGIN:VEVENT', 'DTSTART:20261010T150000Z', 'END:VEVENT'))!.events, []);
});

test('all-day events and floating times have no start to join at', () => {
  const allDay = parseCalendar(ics('BEGIN:VEVENT', 'UID:a', 'DTSTART;VALUE=DATE:20261010', 'URL:https://meet.google.com/abc-defg-hij', 'END:VEVENT'))!;
  assert.equal(allDay.events[0].start, undefined);
  const floating = parseCalendar(ics('BEGIN:VEVENT', 'UID:f', 'DTSTART:20261010T150000', 'END:VEVENT'))!;
  assert.equal(floating.events[0].start, undefined);
  const unknownZone = parseCalendar(ics('BEGIN:VEVENT', 'UID:u', 'DTSTART;TZID=Mars/Olympus_Mons:20261010T150000', 'END:VEVENT'))!;
  assert.equal(unknownZone.events[0].start, undefined);
});

test('recurrence finer than daily, or with huge date lists, is refused', () => {
  for (const rule of ['FREQ=MINUTELY', 'FREQ=SECONDLY', 'FREQ=HOURLY']) {
    const parsed = parseCalendar(ics('BEGIN:VEVENT', 'UID:r', 'DTSTART:20261010T150000Z', `RRULE:${rule}`, 'END:VEVENT'))!;
    assert.deepEqual(parsed.events, [], rule);
  }
  const dates = Array.from({ length: 600 }, (_, i) => `EXDATE:${20261011 + (i % 20)}T150000Z`);
  const many = parseCalendar(ics('BEGIN:VEVENT', 'UID:e', 'DTSTART:20261010T150000Z', 'RRULE:FREQ=DAILY', ...dates, 'END:VEVENT'))!;
  assert.deepEqual(many.events, []);
});

test("one calendar's time zones never leak into another's", () => {
  // A hostile calendar redefines Los Angeles as UTC+14...
  const hostile = ics(
    'METHOD:REQUEST',
    'BEGIN:VTIMEZONE',
    'TZID:America/Los_Angeles',
    'BEGIN:STANDARD',
    'DTSTART:19700101T000000',
    'TZOFFSETFROM:+1400',
    'TZOFFSETTO:+1400',
    'END:STANDARD',
    'END:VTIMEZONE',
    'BEGIN:VEVENT',
    'UID:h',
    'DTSTART;TZID=America/Los_Angeles:20261010T100000',
    'END:VEVENT'
  );
  assert.equal(iso(parseCalendar(hostile)!.events[0].start), '2026-10-09T20:00:00.000Z');
  // ...and the next calendar, which names the zone without describing it, still gets the real one.
  const honest = parseCalendar(ics('BEGIN:VEVENT', 'UID:o', 'DTSTART;TZID=America/Los_Angeles:20261010T100000', 'END:VEVENT'))!;
  assert.equal(iso(honest.events[0].start), '2026-10-10T17:00:00.000Z');
});

test('titles and names are cleaned of control characters and capped', () => {
  const parsed = parseCalendar(
    ics(
      'BEGIN:VEVENT',
      'UID:t',
      'DTSTART:20261010T150000Z',
      `SUMMARY:Weekly\\nsync ‮reversed‬ ${'a'.repeat(300)}`,
      'ORGANIZER;CN="Bob\u0007 Lee":MAILTO:Bob.Lee@Partner.Example',
      'END:VEVENT'
    )
  )!;
  const [event] = parsed.events;
  assert.ok(event.title!.startsWith('Weekly sync reversed '));
  assert.ok(event.title!.length <= 200);
  assert.deepEqual(event.organizer, { email: 'bob.lee@partner.example', name: 'Bob Lee' });
});

test('wall clock times in IANA zones, including a clock change', () => {
  assert.equal(new Date(wallClockToUtc(Date.UTC(2026, 9, 7, 14, 0), 'America/Los_Angeles')!).toISOString(), '2026-10-07T21:00:00.000Z');
  assert.equal(new Date(wallClockToUtc(Date.UTC(2026, 10, 3, 10, 0), 'America/Los_Angeles')!).toISOString(), '2026-11-03T18:00:00.000Z');
  assert.equal(new Date(wallClockToUtc(Date.UTC(2026, 9, 7, 14, 0), 'Asia/Kolkata')!).toISOString(), '2026-10-07T08:30:00.000Z');
  assert.equal(wallClockToUtc(Date.UTC(2026, 9, 7, 14, 0), 'Pacific Standard Time'), null);
});
