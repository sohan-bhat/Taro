import { test, type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { CalendarOccurrenceModel, CompanyModel, GoogleCalendarConnectionModel, UserModel } from '../../db/models';
import { encryptSecret, sha256 } from '../../lib/crypto';
import { memoryModel, useMemory, type Doc, type MemoryModel } from '../../lib/testing/memoryModel';
import { CALENDAR_SCOPE } from './googleApi';
import { disconnect } from './googleConnect';
import { channelNotified, googleCalendarTick, POLL_MS, refreshTokenContext, SAFETY_POLL_MS } from './googleSync';

const MIN = 60_000;
const NOW = new Date('2026-10-07T17:00:00Z');
const COMPANY = '6a1f00000000000000000001';
const PRIYA = '6a1f0000000000000000aa01';
const SAM = '6a1f0000000000000000aa02';

// ---------------------------------------------------------------------------------------------
// A fake Google: each person's calendar, their grants, and every call Taro makes

type Person = 'priya' | 'sam';
const USER_ID: Record<Person, string> = { priya: PRIYA, sam: SAM };
const REFRESH: Record<Person, string> = { priya: '1//priya-refresh-token', sam: '1//sam-refresh-token' };

function fakeGoogle(t: TestContext, calendars: Record<Person, Array<Record<string, unknown>>>) {
  const revoked = new Set<string>();
  const calls: string[] = [];
  const google = { calendars, revoked, calls, onRead: null as null | ((who: Person) => Promise<void>) };
  const personByAccess = (header: string | undefined) => (header?.replace('Bearer access-', '') ?? '') as Person;
  const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

  t.mock.method(globalThis, 'fetch', (async (input: string | URL, init: RequestInit = {}) => {
    const url = new URL(String(input));
    const headers = (init.headers ?? {}) as Record<string, string>;
    const form = typeof init.body === 'string' || init.body instanceof URLSearchParams ? new URLSearchParams(String(init.body)) : null;
    if (url.href === 'https://oauth2.googleapis.com/token') {
      const token = form?.get('refresh_token') ?? '';
      const who = (Object.keys(REFRESH) as Person[]).find((p) => REFRESH[p] === token);
      calls.push(`refresh ${who ?? 'unknown'}`);
      if (!who || revoked.has(token)) return json(400, { error: 'invalid_grant', error_description: 'Token has been expired or revoked.' });
      return json(200, { access_token: `access-${who}`, expires_in: 3599, scope: `openid https://www.googleapis.com/auth/userinfo.email ${CALENDAR_SCOPE}`, token_type: 'Bearer' });
    }
    if (url.href === 'https://oauth2.googleapis.com/revoke') {
      const token = form?.get('token') ?? '';
      calls.push(`revoke ${(Object.keys(REFRESH) as Person[]).find((p) => REFRESH[p] === token) ?? 'unknown'}`);
      revoked.add(token);
      return new Response('', { status: 200 });
    }
    const who = personByAccess(headers.Authorization);
    // Revoking a grant at Google ends its access tokens too
    if (revoked.has(REFRESH[who])) {
      calls.push(`${url.pathname.endsWith('/events') ? 'list' : 'call'} ${who} refused`);
      return json(401, { error: { code: 401, message: 'Invalid Credentials', errors: [{ reason: 'authError' }] } });
    }
    if (url.pathname === '/calendar/v3/calendars/primary/events') {
      calls.push(`list ${who}`);
      assert.equal(url.searchParams.get('singleEvents'), 'true');
      assert.equal(url.searchParams.get('maxAttendees'), '1');
      if (google.onRead) await google.onRead(who);
      return json(200, { items: calendars[who] ?? [] });
    }
    if (url.pathname === '/calendar/v3/calendars/primary/events/watch') {
      const body = JSON.parse(String(init.body));
      calls.push(`watch ${who}`);
      assert.equal(body.address, 'https://api.taro.test/api/google-calendar/notify');
      return json(200, { kind: 'api#channel', id: body.id, resourceId: `resource-${who}`, expiration: String(NOW.getTime() + 7 * 24 * 60 * MIN) });
    }
    if (url.pathname === '/calendar/v3/channels/stop') {
      calls.push(`stop ${who}`);
      return new Response(null, { status: 204 });
    }
    throw new Error(`Unexpected call to ${url.href}`);
  }) as never);
  return google;
}

// ---------------------------------------------------------------------------------------------
// A workspace with two connected members, in memory

function setup(t: TestContext, calendars: Record<Person, Array<Record<string, unknown>>>) {
  const occurrences = useMemory(t, CalendarOccurrenceModel, memoryModel());
  const users = useMemory(
    t,
    UserModel,
    memoryModel([
      { _id: PRIYA, companyId: COMPANY, name: 'Priya Raman', email: 'priya@northwind.dev', role: 'member' },
      { _id: SAM, companyId: COMPANY, name: 'Sam Whitfield', email: 'sam@northwind.dev', role: 'member' },
    ])
  );
  const connections = useMemory(
    t,
    GoogleCalendarConnectionModel,
    memoryModel(
      (['priya', 'sam'] as Person[]).map((who) => ({
        _id: `conn-${who}`,
        companyId: COMPANY,
        userId: USER_ID[who],
        email: `${who}@northwind.dev`,
        googleSub: `sub-${who}`,
        refreshTokenEnc: encryptSecret(REFRESH[who], refreshTokenContext(COMPANY, USER_ID[who])),
        status: 'active',
        autoJoin: true,
        joinMode: 'all',
        nextSyncAt: NOW,
      }))
    )
  );
  // No MeetingBaas key, so the bot sync that follows a change schedules nothing
  t.mock.method(CompanyModel, 'findById', (() => Promise.resolve({ _id: COMPANY, name: 'Northwind', providers: {} })) as never);
  return { occurrences, users, connections, google: fakeGoogle(t, calendars) };
}

// Lets the bot syncs a pass starts in the background finish before the test looks.
async function settle() {
  for (let i = 0; i < 100; i++) await new Promise((resolve) => setImmediate(resolve));
}

/** One pass, reading only `who`'s calendar. */
async function sync(connections: MemoryModel, who: Person[], now = NOW) {
  for (const doc of connections.docs) doc.nextSyncAt = who.some((p) => doc.userId === USER_ID[p]) ? now : new Date(now.getTime() + 60 * MIN);
  const taken = await googleCalendarTick(now);
  await settle();
  return taken;
}

const connectionOf = (connections: MemoryModel, who: Person) => connections.docs.find((d) => d.userId === USER_ID[who]);
const titled = (occurrences: MemoryModel, title: string) => occurrences.docs.filter((d) => d.title === title);
const only = (rows: Doc[]) => {
  assert.equal(rows.length, 1, `expected one occurrence, found ${rows.length}`);
  return rows[0];
};

function event(fields: Record<string, unknown>) {
  return {
    status: 'confirmed',
    eventType: 'default',
    start: { dateTime: '2026-10-08T17:00:00Z' },
    end: { dateTime: '2026-10-08T17:30:00Z' },
    organizer: { email: 'maya@northwind.dev' },
    attendees: [{ self: true, responseStatus: 'accepted' }],
    ...fields,
  };
}

const designReview = (fields: Record<string, unknown> = {}) =>
  event({ id: 'dr1', iCalUID: 'design-review@google.com', summary: 'Design review', hangoutLink: 'https://meet.google.com/kdp-wqmx-tvr', ...fields });
const priyaOneOnOne = (fields: Record<string, unknown> = {}) =>
  event({
    id: 'oo1',
    iCalUID: 'one-on-one@google.com',
    summary: 'Priya and Maya',
    start: { dateTime: '2026-10-09T16:00:00Z' },
    end: { dateTime: '2026-10-09T16:30:00Z' },
    conferenceData: { entryPoints: [{ entryPointType: 'video', uri: 'https://acme.zoom.us/j/99887766554?pwd=x1' }] },
    ...fields,
  });

// ---------------------------------------------------------------------------------------------

test("the same meeting on two members' calendars is one occurrence, held by both", async (t) => {
  const { occurrences, connections, google } = setup(t, {
    priya: [designReview(), priyaOneOnOne()],
    // Sam's copy has its own event ID and time zone; the iCalUID is what's shared
    sam: [designReview({ id: 'dr1-copy', start: { dateTime: '2026-10-08T13:00:00-04:00' }, end: { dateTime: '2026-10-08T13:30:00-04:00' } })],
  });

  assert.equal(await sync(connections, ['priya']), 1);
  assert.equal(await sync(connections, ['sam']), 1);

  const review = only(titled(occurrences, 'Design review'));
  assert.equal(review.source, 'google');
  assert.equal(review.status, 'scheduled');
  assert.deepEqual(review.holders, [PRIYA, SAM]);
  assert.equal(review.seriesId, undefined);
  assert.equal(review.meetUrl, 'https://meet.google.com/kdp-wqmx-tvr');
  assert.deepEqual(review.start, new Date('2026-10-08T17:00:00Z'));
  assert.equal(review.organizerEmail, 'maya@northwind.dev');
  // Sam holding it too changed nothing MeetingBaas needs to hear about: still one bot for one meeting
  assert.equal(review.botRev, 1);

  const oneOnOne = only(titled(occurrences, 'Priya and Maya'));
  assert.deepEqual(oneOnOne.holders, [PRIYA]);
  assert.equal(oneOnOne.platform, 'zoom');
  assert.equal(occurrences.docs.length, 2);

  // Stored: what Taro joins and nothing else. No guests, no description.
  assert.deepEqual(
    Object.keys(review).filter((k) => !['_id', 'companyId', 'uid', 'recurrenceKey'].includes(k)).sort(),
    ['botDirty', 'botRev', 'end', 'expiresAt', 'holders', 'launchAt', 'meetUrl', 'organizerEmail', 'platform', 'recurring', 'source', 'start', 'status', 'title']
  );

  // Sam's was read last: synced now, read again in two minutes, with a push channel open
  const sam = connectionOf(connections, 'sam')!;
  assert.deepEqual(sam.lastSyncedAt, NOW);
  assert.deepEqual(sam.nextSyncAt, new Date(NOW.getTime() + POLL_MS));
  assert.equal(sam.syncLeaseUntil, undefined);
  assert.equal((sam.channel as { resourceId: string }).resourceId, 'resource-sam');
  assert.deepEqual([...google.calls].sort(), ['list priya', 'list sam', 'refresh priya', 'refresh sam', 'watch priya', 'watch sam']);

  // Read again, both at once, with nothing changed: nothing is written
  const before = JSON.stringify(occurrences.docs);
  assert.equal(await sync(connections, ['priya', 'sam'], new Date(NOW.getTime() + 2 * MIN)), 2);
  assert.equal(JSON.stringify(occurrences.docs), before);
});

test('two members read at the same moment still make one occurrence', async (t) => {
  const { occurrences, connections } = setup(t, { priya: [designReview()], sam: [designReview({ id: 'dr1-copy' })] });
  assert.equal(await sync(connections, ['priya', 'sam']), 2);
  const review = only(titled(occurrences, 'Design review'));
  assert.deepEqual([...(review.holders as string[])].sort(), [PRIYA, SAM]);
  assert.equal(review.status, 'scheduled');
});

test('disconnecting keeps a meeting another member still has, and cancels the ones only they had', async (t) => {
  const { occurrences, connections, google } = setup(t, { priya: [designReview(), priyaOneOnOne()], sam: [designReview()] });
  await sync(connections, ['priya', 'sam']);
  google.calls.length = 0;

  await disconnect(COMPANY, PRIYA, NOW);
  await settle();

  // Her push channel closes and her grant is revoked at Google, then the token is gone with the connection
  assert.deepEqual(google.calls, ['stop priya', 'revoke priya']);
  assert.ok(google.revoked.has(REFRESH.priya));
  assert.equal(connectionOf(connections, 'priya'), undefined);

  const review = only(titled(occurrences, 'Design review'));
  assert.equal(review.status, 'scheduled');
  assert.deepEqual(review.holders, [SAM]);
  const oneOnOne = only(titled(occurrences, 'Priya and Maya'));
  assert.equal(oneOnOne.status, 'canceled');
  assert.deepEqual(oneOnOne.holders, []);

  // Sam deletes the meeting from his calendar too: now nobody connected has it
  google.calendars.sam = [];
  await sync(connections, ['sam'], new Date(NOW.getTime() + 2 * MIN));
  assert.equal(only(titled(occurrences, 'Design review')).status, 'canceled');
});

test('a moved meeting moves its occurrence and its bot; a Skip stands; a decline lets go', async (t) => {
  const { occurrences, connections, google } = setup(t, { priya: [designReview(), priyaOneOnOne()], sam: [] });
  await sync(connections, ['priya']);
  const first = only(titled(occurrences, 'Design review'));

  // Moved an hour later, and relinked
  google.calendars.priya = [
    designReview({ start: { dateTime: '2026-10-08T18:00:00Z' }, end: { dateTime: '2026-10-08T18:30:00Z' }, hangoutLink: 'https://meet.google.com/abc-defg-hij' }),
    priyaOneOnOne(),
  ];
  await sync(connections, ['priya'], new Date(NOW.getTime() + 2 * MIN));
  const moved = only(titled(occurrences, 'Design review'));
  assert.equal(moved._id, first._id);
  assert.deepEqual(moved.start, new Date('2026-10-08T18:00:00Z'));
  assert.equal(moved.meetUrl, 'https://meet.google.com/abc-defg-hij');
  // Marked for MeetingBaas: its scheduled bot moves with it
  assert.equal(moved.botRev, 2);

  // Someone skips the one-on-one in Upcoming; reading the calendar again doesn't undo it
  const oneOnOne = only(titled(occurrences, 'Priya and Maya'));
  oneOnOne.status = 'skipped';
  oneOnOne.skipReason = 'person';
  await sync(connections, ['priya'], new Date(NOW.getTime() + 4 * MIN));
  assert.equal(only(titled(occurrences, 'Priya and Maya')).status, 'skipped');

  // She declines the design review: Taro lets go of it
  google.calendars.priya = [designReview({ attendees: [{ self: true, responseStatus: 'declined' }] }), priyaOneOnOne()];
  await sync(connections, ['priya'], new Date(NOW.getTime() + 6 * MIN));
  const declined = only(titled(occurrences, 'Design review'));
  assert.equal(declined.status, 'canceled');
  assert.deepEqual(declined.holders, []);

  // And accepts again: it's back
  google.calendars.priya = [designReview({ start: { dateTime: '2026-10-08T18:00:00Z' }, end: { dateTime: '2026-10-08T18:30:00Z' } }), priyaOneOnOne()];
  await sync(connections, ['priya'], new Date(NOW.getTime() + 8 * MIN));
  assert.equal(only(titled(occurrences, 'Design review')).status, 'scheduled');
});

test('"Only meetings I organize" lets go of the meetings someone else organizes', async (t) => {
  const { occurrences, connections, google } = setup(t, {
    priya: [designReview(), priyaOneOnOne({ organizer: { email: 'priya@northwind.dev', self: true }, attendeesOmitted: true })],
    sam: [],
  });
  await sync(connections, ['priya']);
  assert.equal(occurrences.docs.filter((d) => d.status === 'scheduled').length, 2);

  connectionOf(connections, 'priya')!.joinMode = 'organizer';
  await sync(connections, ['priya'], new Date(NOW.getTime() + 2 * MIN));
  assert.equal(only(titled(occurrences, 'Design review')).status, 'canceled');
  assert.equal(only(titled(occurrences, 'Priya and Maya')).status, 'scheduled');
  assert.equal(google.calls.filter((c) => c === 'list priya').length, 2);
});

test('a revoked or expired grant marks the connection for reconnecting and stops syncing it', async (t) => {
  const { occurrences, connections, google } = setup(t, { priya: [designReview(), priyaOneOnOne()], sam: [designReview()] });
  await sync(connections, ['priya', 'sam']);

  // Priya removes Taro from her Google account
  google.revoked.add(REFRESH.priya);
  google.calls.length = 0;
  await sync(connections, ['priya'], new Date(NOW.getTime() + 2 * MIN));

  const priya = connectionOf(connections, 'priya')!;
  assert.equal(priya.status, 'reconnect');
  assert.equal(priya.refreshTokenEnc, undefined);
  assert.equal(priya.channel, undefined);
  // Google turned the access token away, then refused a new one: invalid_grant
  assert.deepEqual(google.calls, ['list priya refused', 'refresh priya']);
  // Her meetings are let go: the one only she had is canceled, the shared one stays for Sam
  assert.equal(only(titled(occurrences, 'Priya and Maya')).status, 'canceled');
  assert.deepEqual(only(titled(occurrences, 'Design review')).holders, [SAM]);

  // Nothing syncs it again until she reconnects
  for (const doc of connections.docs) doc.nextSyncAt = new Date(NOW.getTime() + 3 * MIN);
  google.calls.length = 0;
  assert.equal(await googleCalendarTick(new Date(NOW.getTime() + 10 * MIN)), 1);
  await settle();
  assert.deepEqual(google.calls, ['list sam']);
});

test('a disconnect while the calendar is being read leaves nothing held', async (t) => {
  const { occurrences, connections, google } = setup(t, { priya: [priyaOneOnOne()], sam: [] });
  google.onRead = async (who) => {
    if (who !== 'priya') return;
    google.onRead = null;
    await disconnect(COMPANY, PRIYA, NOW);
  };
  await sync(connections, ['priya']);
  const oneOnOne = only(titled(occurrences, 'Priya and Maya'));
  assert.deepEqual(oneOnOne.holders, []);
  assert.equal(oneOnOne.status, 'canceled');
});

test('turning automatic joining off lets go of everything without reading the calendar', async (t) => {
  const { occurrences, connections, google } = setup(t, { priya: [designReview(), priyaOneOnOne()], sam: [] });
  await sync(connections, ['priya']);
  connectionOf(connections, 'priya')!.autoJoin = false;
  google.calls.length = 0;
  await sync(connections, ['priya'], new Date(NOW.getTime() + 2 * MIN));
  assert.deepEqual(google.calls, []);
  assert.ok(occurrences.docs.every((d) => d.status === 'canceled'));
  // And it isn't looked at again for an hour
  assert.deepEqual(connectionOf(connections, 'priya')!.nextSyncAt, new Date(NOW.getTime() + 62 * MIN));
});

test("Google's notifications are checked against the channel's token, and bring the next read forward", async (t) => {
  const { connections } = setup(t, { priya: [designReview()], sam: [] });
  await sync(connections, ['priya']);
  const priya = connectionOf(connections, 'priya')!;
  const channel = priya.channel as { id: string; tokenHash: string; resourceId: string };
  // The token itself was only ever sent to Google; Taro keeps its hash
  assert.match(channel.tokenHash, /^[0-9a-f]{64}$/);
  const secret = 'the-channel-token';
  channel.tokenHash = sha256(secret);

  const later = new Date(NOW.getTime() + 60_000);
  assert.equal(await channelNotified({ channelId: channel.id, token: 'guess', resourceId: channel.resourceId, state: 'exists' }, later), false);
  assert.equal(await channelNotified({ channelId: channel.id, token: secret, resourceId: 'resource-sam', state: 'exists' }, later), false);
  assert.equal(await channelNotified({ channelId: 'unknown', token: secret, resourceId: channel.resourceId, state: 'exists' }, later), false);
  assert.deepEqual(priya.nextSyncAt, new Date(NOW.getTime() + POLL_MS));

  assert.equal(await channelNotified({ channelId: channel.id, token: secret, resourceId: channel.resourceId, state: 'sync' }, later), true);
  assert.deepEqual((priya.channel as { confirmedAt?: Date }).confirmedAt, later);
  assert.equal(await channelNotified({ channelId: channel.id, token: secret, resourceId: channel.resourceId, state: 'exists' }, later), true);
  assert.deepEqual(priya.nextSyncAt, later);

  // With notifications arriving, polling slows to a safety net
  await sync(connections, ['priya'], later);
  assert.deepEqual(priya.nextSyncAt, new Date(later.getTime() + SAFETY_POLL_MS));
});
