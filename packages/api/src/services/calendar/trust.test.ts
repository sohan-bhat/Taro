import { test } from 'node:test';
import assert from 'node:assert/strict';
import { findSponsor, senderSpeaksForOrganizer } from './trust';

// Members of the Northwind workspace, as the database would answer.
const MEMBERS: Record<string, string> = { 'maya@northwind.dev': 'Maya Chen', 'priya@northwind.dev': 'Priya Raman' };
const isMember = async (email: string) => (MEMBERS[email] ? { name: MEMBERS[email], userId: `u_${email.split('@')[0]}` } : null);

test('a member who sends the invitation vouches for it, whoever organized it', async () => {
  assert.deepEqual(await findSponsor({ from: 'priya@northwind.dev', organizerEmail: 'bob@partner.example' }, isMember), {
    name: 'Priya Raman',
    userId: 'u_priya',
  });
});

test('a member organizer vouches when the mail came from them or from Google Calendar for them', async () => {
  const maya = { name: 'Maya Chen', userId: 'u_maya' };
  assert.deepEqual(await findSponsor({ from: 'maya@northwind.dev', organizerEmail: 'maya@northwind.dev' }, isMember), maya);
  assert.deepEqual(await findSponsor({ from: 'calendar-notification@google.com', organizerEmail: 'maya@northwind.dev' }, isMember), maya);
  // An assistant or a room system at the same company
  assert.deepEqual(await findSponsor({ from: 'rooms@northwind.dev', organizerEmail: 'maya@northwind.dev' }, isMember), maya);
});

test('a forged organizer does not: a member named in an invitation someone else sent', async () => {
  assert.equal(await findSponsor({ from: 'maya.chen.northwind@gmail.com', organizerEmail: 'maya@northwind.dev' }, isMember), null);
  assert.equal(await findSponsor({ from: 'attacker@evil.example', organizerEmail: 'maya@northwind.dev' }, isMember), null);
  assert.equal(await findSponsor({ organizerEmail: 'maya@northwind.dev' }, isMember), null);
});

test('an unknown organizer sending their own invitation waits for approval', async () => {
  assert.equal(await findSponsor({ from: 'bob@partner.example', organizerEmail: 'bob@partner.example' }, isMember), null);
});

test('sharing a public mail domain says nothing', () => {
  assert.ok(!senderSpeaksForOrganizer('someone@gmail.com', 'member@gmail.com'));
  assert.ok(senderSpeaksForOrganizer('member@gmail.com', 'member@gmail.com'));
  assert.ok(senderSpeaksForOrganizer('desk@northwind.dev', 'maya@northwind.dev'));
  assert.ok(!senderSpeaksForOrganizer('maya@northwind.dev.evil.example', 'maya@northwind.dev'));
  assert.ok(!senderSpeaksForOrganizer(undefined, 'maya@northwind.dev'));
});
