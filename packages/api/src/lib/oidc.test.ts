import { test } from 'node:test';
import assert from 'node:assert/strict';
import { checkGoogleIdToken, decodeJwtPayload, IdTokenRejected, oidcNonce, type Claims } from './oidc';

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
  assert.equal(rejection(() => checkGoogle(google({ iss: 'https://slack.com' }))), 'invalid');
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
