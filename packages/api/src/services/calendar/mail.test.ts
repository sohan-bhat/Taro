import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import path from 'path';
import { isCalendarPart, readPostmark, readRawMail } from './mail';

const fixture = (name: string) => fs.readFileSync(path.join(__dirname, 'fixtures', name));
const TARO = 'k3j2h1g0f9e8d7c6b5a4@invite.taro.test';

test('Google Calendar mail: the invitation once, though it comes inline and as invite.ics', async () => {
  const mail = await readRawMail(fixture('google-single.eml'));
  assert.equal(mail.from, 'maya@northwind.dev');
  assert.deepEqual(mail.recipients, [TARO]);
  assert.equal(mail.calendars.length, 1);
  assert.match(mail.calendars[0], /^BEGIN:VCALENDAR/);
  assert.match(mail.calendars[0], /UID:5n2k8q1v0m3c7b4x9z6a2d1f0g@google\.com/);
});

test('Outlook mail: the calendar part is inline and base64 encoded', async () => {
  const mail = await readRawMail(fixture('outlook-teams.eml'));
  assert.equal(mail.from, 'daniel@northwind.dev');
  assert.deepEqual(mail.recipients, [TARO]);
  assert.equal(mail.calendars.length, 1);
  assert.match(mail.calendars[0], /X-MICROSOFT-SKYPETEAMSMEETINGURL/);
});

test('mail without an invitation has no calendars, whatever links it holds', async () => {
  const mail = await readRawMail(fixture('newsletter.eml'));
  assert.deepEqual(mail.calendars, []);
});

test('the envelope recipient counts, for mail Taro got as a Bcc', async () => {
  const raw = fixture('google-single.eml').toString('utf8').replace(`To: ${TARO}`, 'To: someone@northwind.dev');
  const mail = await readRawMail(raw, ['Other.Address@Invite.Taro.Test']);
  assert.deepEqual(mail.recipients, ['other.address@invite.taro.test', 'someone@northwind.dev']);
});

test('an invitation forwarded as an attached message is still read', async () => {
  const inner = fixture('google-single.eml').toString('utf8');
  const raw = [
    'From: Priya Raman <priya@northwind.dev>',
    `To: ${TARO}`,
    'Subject: Fwd: Invitation',
    'MIME-Version: 1.0',
    'Content-Type: multipart/mixed; boundary="fwd"',
    '',
    '--fwd',
    'Content-Type: text/plain',
    '',
    'Taro, come to this one.',
    '--fwd',
    'Content-Type: message/rfc822',
    '',
    inner,
    '--fwd--',
    '',
  ].join('\r\n');
  const mail = await readRawMail(raw);
  assert.equal(mail.from, 'priya@northwind.dev');
  assert.equal(mail.calendars.length, 1);
});

test("Postmark's JSON: attachments in base64, and plus addressing in OriginalRecipient", async () => {
  const ics = fixture('outlook-teams.ics').toString('utf8');
  const recipient = `451d9b70cf9364d23ff6f9d51d870251+k3j2h1g0f9e8d7c6b5a4@inbound.postmarkapp.com`;
  const mail = await readPostmark({
    From: 'daniel@northwind.dev',
    FromFull: { Email: 'Daniel@Northwind.dev', Name: 'Daniel Okafor', MailboxHash: '' },
    ToFull: [{ Email: recipient, Name: '', MailboxHash: 'k3j2h1g0f9e8d7c6b5a4' }],
    CcFull: [{ Email: 'maya@northwind.dev', Name: 'Maya Chen' }],
    OriginalRecipient: recipient,
    MailboxHash: 'k3j2h1g0f9e8d7c6b5a4',
    Subject: 'Vendor review',
    TextBody: 'Join https://zoom.us/j/1',
    Headers: [{ Name: 'X-Spam-Status', Value: 'No' }],
    Attachments: [
      { Name: 'deck.pdf', Content: Buffer.from('%PDF-1.7').toString('base64'), ContentType: 'application/pdf', ContentLength: 8 },
      { Name: 'invite.ics', Content: Buffer.from(ics).toString('base64'), ContentType: 'text/calendar; charset=utf-8; method=REQUEST', ContentLength: ics.length },
    ],
  });
  assert.ok(mail);
  assert.equal(mail.from, 'daniel@northwind.dev');
  assert.deepEqual(mail.recipients, [recipient, 'maya@northwind.dev']);
  assert.equal(mail.calendars.length, 1);
  assert.equal(mail.calendars[0], ics);
});

test("Postmark's JSON with the raw message included reads the message itself", async () => {
  const raw = fixture('outlook-teams.eml').toString('utf8');
  const mail = await readPostmark({ FromFull: { Email: 'daniel@northwind.dev' }, OriginalRecipient: TARO, Attachments: [], RawEmail: raw });
  assert.ok(mail);
  assert.equal(mail.calendars.length, 1);
  assert.deepEqual(mail.recipients, [TARO]);
});

test('JSON that is not from Postmark is not mail', async () => {
  assert.equal(await readPostmark({ hello: 'world' }), null);
  assert.equal(await readPostmark([1, 2, 3]), null);
  assert.equal(await readPostmark(null), null);
  // Fields of the wrong types are skipped rather than trusted.
  const odd = await readPostmark({ FromFull: { Email: { $gt: '' } }, ToFull: 'nope', Attachments: [{ Name: 5, Content: 7, ContentType: [] }] });
  assert.deepEqual(odd, { from: undefined, recipients: [], calendars: [] });
});

test('only calendar parts count', () => {
  assert.ok(isCalendarPart('text/calendar; method=REQUEST'));
  assert.ok(isCalendarPart('application/ics'));
  assert.ok(isCalendarPart('application/octet-stream', 'Invite.ICS'));
  assert.ok(!isCalendarPart('text/html'));
  assert.ok(!isCalendarPart('application/pdf', 'agenda.pdf'));
  assert.ok(!isCalendarPart(undefined, undefined));
});
