import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  addressWith,
  calendarInvitesConfigured,
  inviteAddressFor,
  isInviteToken,
  newInviteToken,
  parseTemplate,
  tokenFromAddress,
  tokenWith,
  TOKEN_LENGTH,
} from './inviteAddress';

const TOKEN = 'k3j2h1g0f9e8d7c6b5a4';

test('tokens are long, lowercase, and different every time', () => {
  const tokens = new Set(Array.from({ length: 200 }, () => newInviteToken()));
  assert.equal(tokens.size, 200);
  for (const token of tokens) {
    assert.equal(token.length, TOKEN_LENGTH);
    assert.ok(isInviteToken(token), token);
  }
  assert.ok(!isInviteToken('K3J2H1G0F9E8D7C6B5A4'));
  assert.ok(!isInviteToken('short'));
});

test('a catch-all domain address carries the token as its local part', () => {
  const template = parseTemplate('{token}@invite.example.com')!;
  assert.ok(template);
  assert.equal(addressWith(template, TOKEN), `${TOKEN}@invite.example.com`);
  assert.equal(tokenWith(template, `${TOKEN}@invite.example.com`), TOKEN);
  // Calendars and mail servers change case; tokens are lowercase, so matching ignores it.
  assert.equal(tokenWith(template, `${TOKEN.toUpperCase()}@INVITE.EXAMPLE.COM`), TOKEN);
  assert.equal(tokenWith(template, ` ${TOKEN}@invite.example.com `), TOKEN);
});

test("a provider's plus addressing carries the token after the plus", () => {
  const template = parseTemplate('451d9b70cf9364d23ff6f9d51d870251+{token}@inbound.postmarkapp.com')!;
  assert.ok(template);
  const address = `451d9b70cf9364d23ff6f9d51d870251+${TOKEN}@inbound.postmarkapp.com`;
  assert.equal(addressWith(template, TOKEN), address);
  assert.equal(tokenWith(template, address), TOKEN);
  // The server's own address, without a token, belongs to no workspace.
  assert.equal(tokenWith(template, '451d9b70cf9364d23ff6f9d51d870251@inbound.postmarkapp.com'), null);
});

test('other addresses never yield a token', () => {
  const template = parseTemplate('taro-{token}@invite.example.com')!;
  assert.equal(tokenWith(template, `taro-${TOKEN}@invite.example.com`), TOKEN);
  assert.equal(tokenWith(template, `${TOKEN}@invite.example.com`), null);
  assert.equal(tokenWith(template, `taro-${TOKEN}@invite.example.com.evil.test`), null);
  assert.equal(tokenWith(template, `taro-${TOKEN}x@invite.example.com`), null);
  assert.equal(tokenWith(template, `taro-${TOKEN.slice(1)}!@invite.example.com`), null);
  assert.equal(tokenWith(template, 'maya@northwind.dev'), null);
});

test('templates must be one address with {token} before the @', () => {
  assert.equal(parseTemplate('invite.example.com'), null);
  assert.equal(parseTemplate('taro@{token}.example.com'), null);
  assert.equal(parseTemplate('{token}{token}@invite.example.com'), null);
  assert.equal(parseTemplate('{token}@localhost'), null);
  assert.equal(parseTemplate('{token} @invite.example.com'), null);
  assert.deepEqual(parseTemplate(' {token}@Invite.Example.com '), { prefix: '', suffix: '@invite.example.com' });
});

test('the server reads INVITE_ADDRESS and INBOUND_SECRET', () => {
  // test.env sets {token}@invite.taro.test and a long secret.
  assert.ok(calendarInvitesConfigured());
  assert.equal(inviteAddressFor(TOKEN), `${TOKEN}@invite.taro.test`);
  assert.equal(tokenFromAddress(`${TOKEN}@invite.taro.test`), TOKEN);
  assert.equal(tokenFromAddress(`${TOKEN}@invite.taro.example`), null);
});
