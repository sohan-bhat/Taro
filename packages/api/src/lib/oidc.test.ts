import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  checkGoogleIdToken,
  checkMicrosoftIdToken,
  decodeJwtPayload,
  IdTokenRejected,
  MICROSOFT_PERSONAL_TENANT,
  oidcNonce,
  tenantAllowed,
  type Claims,
} from './oidc';

const NOW = Date.parse('2026-10-04T12:00:00Z');
const SECONDS = NOW / 1000;
const NONCE = oidcNonce('signed-state');

const GOOGLE_CLIENT = '1234-abc.apps.googleusercontent.com';
const google = (overrides: Claims = {}): Claims => ({
  iss: 'https://accounts.google.com',
  aud: GOOGLE_CLIENT,
  azp: GOOGLE_CLIENT,
  sub: '110169484474386276334',
  email: 'priya@acme.com',
  email_verified: true,
  hd: 'Acme.com',
  name: 'Priya Raman',
  given_name: 'Priya',
  picture: 'https://lh3.googleusercontent.com/a/priya',
  nonce: NONCE,
  iat: SECONDS - 5,
  exp: SECONDS + 3600,
  ...overrides,
});
const checkGoogle = (claims: Claims) => checkGoogleIdToken(claims, { clientId: GOOGLE_CLIENT, nonce: NONCE, now: NOW });

const MS_CLIENT = '6731de76-14a6-49ae-97bc-6eba6914391e';
const CONTOSO = '72f988bf-86f1-41af-91ab-2d7cd011db47';
const microsoft = (overrides: Claims = {}): Claims => ({
  ver: '2.0',
  iss: `https://login.microsoftonline.com/${CONTOSO}/v2.0`,
  aud: MS_CLIENT,
  tid: CONTOSO,
  oid: '00000000-0000-0000-66f3-3332eca7ea81',
  sub: 'AAAAAAAAAAAAAAAAAAAAAIkzqFVrSaSaFHy782bbtaQ',
  name: 'Sam Okafor',
  email: 'sam@contoso.com',
  preferred_username: 'sam@contoso.onmicrosoft.com',
  nonce: NONCE,
  iat: SECONDS - 5,
  nbf: SECONDS - 5,
  exp: SECONDS + 3600,
  ...overrides,
});
const checkMicrosoft = (claims: Claims, authority = 'common') =>
  checkMicrosoftIdToken(claims, { clientId: MS_CLIENT, nonce: NONCE, authority, now: NOW });

// Why an ID token was turned away, or "accepted"
function rejection(run: () => unknown): string {
  try {
    run();
  } catch (error) {
    if (error instanceof IdTokenRejected) return error.reason;
    throw error;
  }
  return 'accepted';
}

test('the nonce comes from the signed state, so each sign-in has its own', () => {
  assert.equal(oidcNonce('signed-state'), NONCE);
  assert.notEqual(oidcNonce('another-state'), NONCE);
  assert.match(NONCE, /^[0-9a-f]{32}$/);
});

test('reads the claims out of an ID token', () => {
  const body = Buffer.from(JSON.stringify({ sub: '42', email: 'a@b.c' })).toString('base64url');
  assert.deepEqual(decodeJwtPayload(`eyJhbGciOiJSUzI1NiJ9.${body}.signature`), { sub: '42', email: 'a@b.c' });
  assert.throws(() => decodeJwtPayload('not-a-jwt'));
});

test('a Google token for this app and this sign-in is accepted, with its domain', () => {
  assert.deepEqual(checkGoogle(google()), {
    sub: '110169484474386276334',
    email: 'priya@acme.com',
    hd: 'acme.com',
    name: 'Priya Raman',
    givenName: 'Priya',
    picture: 'https://lh3.googleusercontent.com/a/priya',
  });
  // Google uses both spellings of its issuer
  assert.equal(checkGoogle(google({ iss: 'accounts.google.com' })).sub, '110169484474386276334');
  // A Gmail account has no domain
  assert.equal(checkGoogle(google({ hd: undefined })).hd, undefined);
});

test('a Google token from elsewhere, for another app, or for another sign-in is refused', () => {
  assert.equal(rejection(() => checkGoogle(google({ iss: 'https://accounts.google.com.evil.example' }))), 'invalid');
  assert.equal(rejection(() => checkGoogle(google({ iss: 'https://login.microsoftonline.com/x/v2.0' }))), 'invalid');
  assert.equal(rejection(() => checkGoogle(google({ aud: 'someone-else.apps.googleusercontent.com' }))), 'invalid');
  // Several audiences are only fine when this app is the one it was handed to
  assert.equal(rejection(() => checkGoogle(google({ aud: ['other', GOOGLE_CLIENT], azp: 'other' }))), 'invalid');
  assert.equal(checkGoogle(google({ aud: ['other', GOOGLE_CLIENT], azp: GOOGLE_CLIENT })).sub, '110169484474386276334');
  assert.equal(rejection(() => checkGoogle(google({ nonce: oidcNonce('another-state') }))), 'invalid');
  assert.equal(rejection(() => checkGoogle(google({ nonce: undefined }))), 'invalid');
  assert.equal(rejection(() => checkGoogle(google({ sub: '' }))), 'invalid');
});

test('an expired Google token is refused, allowing for a little clock drift', () => {
  assert.equal(rejection(() => checkGoogle(google({ exp: SECONDS - 600 }))), 'invalid');
  assert.equal(rejection(() => checkGoogle(google({ exp: undefined }))), 'invalid');
  assert.equal(checkGoogle(google({ exp: SECONDS - 30 })).sub, '110169484474386276334');
});

test('Google sign-in needs an email address Google has verified', () => {
  assert.equal(rejection(() => checkGoogle(google({ email_verified: false }))), 'unverified_email');
  assert.equal(rejection(() => checkGoogle(google({ email_verified: undefined }))), 'unverified_email');
  assert.equal(rejection(() => checkGoogle(google({ email: undefined }))), 'unverified_email');
  assert.equal(checkGoogle(google({ email_verified: 'true' })).email, 'priya@acme.com');
});

test('a Microsoft work account token is checked against the tenant it names', () => {
  assert.deepEqual(checkMicrosoft(microsoft()), {
    tid: CONTOSO,
    oid: '00000000-0000-0000-66f3-3332eca7ea81',
    email: 'sam@contoso.com',
    name: 'Sam Okafor',
  });
  // The common authority lets any tenant answer, so an issuer for another tenant than the token names is refused
  const fabrikam = 'b9419818-09af-49c2-b0c3-653adc1f376e';
  assert.equal(rejection(() => checkMicrosoft(microsoft({ iss: `https://login.microsoftonline.com/${fabrikam}/v2.0` }))), 'invalid');
  // v1.0 tokens and other issuers aren't accepted
  assert.equal(rejection(() => checkMicrosoft(microsoft({ iss: `https://sts.windows.net/${CONTOSO}/` }))), 'invalid');
  assert.equal(rejection(() => checkMicrosoft(microsoft({ tid: 'common', iss: 'https://login.microsoftonline.com/common/v2.0' }))), 'invalid');
  assert.equal(rejection(() => checkMicrosoft(microsoft({ tid: undefined }))), 'invalid');
});

test('a Microsoft token for another app, another sign-in, or out of date is refused', () => {
  assert.equal(rejection(() => checkMicrosoft(microsoft({ aud: '00000003-0000-0000-c000-000000000000' }))), 'invalid');
  assert.equal(rejection(() => checkMicrosoft(microsoft({ nonce: oidcNonce('another-state') }))), 'invalid');
  assert.equal(rejection(() => checkMicrosoft(microsoft({ exp: SECONDS - 600 }))), 'invalid');
  assert.equal(rejection(() => checkMicrosoft(microsoft({ nbf: SECONDS + 600 }))), 'invalid');
  assert.equal(rejection(() => checkMicrosoft(microsoft({ oid: undefined }))), 'invalid');
});

test('a Microsoft email is for display, taken from the username when the email claim is missing', () => {
  assert.equal(checkMicrosoft(microsoft({ email: undefined })).email, 'sam@contoso.onmicrosoft.com');
  assert.equal(checkMicrosoft(microsoft({ email: undefined, preferred_username: '+1 555 0100' })).email, undefined);
  // Microsoft seldom says either way, but an address it calls unverified is refused like Google's
  assert.equal(rejection(() => checkMicrosoft(microsoft({ email_verified: false }))), 'unverified_email');
});

test('MICROSOFT_AUTHORITY decides which tenants may sign in', () => {
  const personal = microsoft({
    tid: MICROSOFT_PERSONAL_TENANT,
    iss: `https://login.microsoftonline.com/${MICROSOFT_PERSONAL_TENANT}/v2.0`,
  });
  assert.equal(checkMicrosoft(personal).tid, MICROSOFT_PERSONAL_TENANT);
  assert.equal(rejection(() => checkMicrosoft(personal, 'organizations')), 'invalid');
  assert.equal(checkMicrosoft(personal, 'consumers').tid, MICROSOFT_PERSONAL_TENANT);
  assert.equal(rejection(() => checkMicrosoft(microsoft(), 'consumers')), 'invalid');
  assert.equal(checkMicrosoft(microsoft(), CONTOSO).tid, CONTOSO);
  assert.equal(rejection(() => checkMicrosoft(microsoft(), 'b9419818-09af-49c2-b0c3-653adc1f376e')), 'invalid');

  assert.ok(tenantAllowed(CONTOSO.toUpperCase(), CONTOSO));
  assert.ok(tenantAllowed(CONTOSO, 'organizations'));
  assert.ok(!tenantAllowed(MICROSOFT_PERSONAL_TENANT, 'organizations'));
});
