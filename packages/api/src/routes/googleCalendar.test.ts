import { test, before, after, type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import http from 'http';
import type { AddressInfo } from 'net';
import express from 'express';
import { GoogleCalendarConnectionModel, GoogleCalendarGrantModel } from '../db/models';
import { decryptSecret, signToken } from '../lib/crypto';
import { oidcNonce } from '../lib/oidc';
import { memoryModel, useMemory, type MemoryModel } from '../lib/testing/memoryModel';
import { CALENDAR_SCOPE } from '../services/calendar/googleApi';
import { connectUrl, redeemGrant, updateSettings } from '../services/calendar/googleConnect';
import { refreshTokenContext } from '../services/calendar/googleSync';
import { authRouter } from './auth';

// From test.env
const CLIENT_ID = 'test-google-client.apps.googleusercontent.com';
const APP = 'https://app.taro.test';
const COMPANY = '6a1f00000000000000000001';
const PRIYA = '6a1f0000000000000000aa01';
const SAM = '6a1f0000000000000000aa02';

const realFetch = globalThis.fetch;
let server: http.Server;
let base = '';

before(async () => {
  const app = express();
  app.use('/api/auth', authRouter);
  server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

after(() => new Promise<void>((resolve) => server.close(() => resolve())));

const jwt = (claims: Record<string, unknown>) =>
  `${Buffer.from('{"alg":"RS256"}').toString('base64url')}.${Buffer.from(JSON.stringify(claims)).toString('base64url')}.sig`;

/** Google's token endpoint and revoke endpoint, faked; calls to this test's own server go through. */
function fakeGoogle(t: TestContext, answer: (form: URLSearchParams) => { status: number; body: unknown }) {
  const calls: Array<{ url: string; form: URLSearchParams }> = [];
  t.mock.method(globalThis, 'fetch', (async (input: string | URL, init: RequestInit = {}) => {
    const url = String(input);
    if (url.startsWith(base)) return realFetch(input, init);
    const form = new URLSearchParams(String(init.body ?? ''));
    calls.push({ url, form });
    if (url === 'https://oauth2.googleapis.com/revoke') return new Response('', { status: 200 });
    if (url !== 'https://oauth2.googleapis.com/token') throw new Error(`Unexpected call to ${url}`);
    const { status, body } = answer(form);
    return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
  }) as never);
  return calls;
}

function consentAnswer(state: string, scope = `openid https://www.googleapis.com/auth/userinfo.email ${CALENDAR_SCOPE}`) {
  return () => ({
    status: 200,
    body: {
      access_token: 'ya29.access',
      refresh_token: '1//priya-refresh-token',
      expires_in: 3599,
      scope,
      token_type: 'Bearer',
      id_token: jwt({
        iss: 'https://accounts.google.com',
        aud: CLIENT_ID,
        sub: '110169484474386276334',
        email: 'Priya@Northwind.dev',
        email_verified: true,
        nonce: oidcNonce(state),
        exp: Math.floor(Date.now() / 1000) + 3600,
      }),
    },
  });
}

async function callback(query: Record<string, string>) {
  const res = await realFetch(`${base}/api/auth/google/callback?${new URLSearchParams(query)}`, { redirect: 'manual' });
  return new URL(res.headers.get('location') ?? '', 'http://unset');
}

function startConnecting(): string {
  const url = new URL(connectUrl({ companyId: COMPANY, userId: PRIYA, loginHint: 'priya@northwind.dev' }, APP));
  return url.searchParams.get('state')!;
}

function stores(t: TestContext): { grants: MemoryModel; connections: MemoryModel } {
  return {
    grants: useMemory(t, GoogleCalendarGrantModel, memoryModel()),
    connections: useMemory(t, GoogleCalendarConnectionModel, memoryModel()),
  };
}

test('Connect Google Calendar asks for reading events only, offline, on the redirect URI sign-in already registered', () => {
  const url = new URL(connectUrl({ companyId: COMPANY, userId: PRIYA, loginHint: 'priya@northwind.dev' }, APP));
  assert.equal(`${url.origin}${url.pathname}`, 'https://accounts.google.com/o/oauth2/v2/auth');
  const q = url.searchParams;
  assert.equal(q.get('scope'), `openid email ${CALENDAR_SCOPE}`);
  assert.ok(!/calendar(\.events)?( |$)/.test(q.get('scope')!), 'never a scope that can change a calendar');
  assert.equal(q.get('access_type'), 'offline');
  assert.equal(q.get('prompt'), 'consent');
  assert.equal(q.get('include_granted_scopes'), 'true');
  assert.equal(q.get('login_hint'), 'priya@northwind.dev');
  assert.equal(q.get('client_id'), CLIENT_ID);
  assert.equal(q.get('redirect_uri'), 'https://api.taro.test/api/auth/google/callback');
  assert.equal(q.get('nonce'), oidcNonce(q.get('state')!));
});

test('the shared callback finishes a calendar connection when the state says so, parking a grant for the person who started', async (t) => {
  const { grants, connections } = stores(t);
  const state = startConnecting();
  const calls = fakeGoogle(t, consentAnswer(state));

  const back = await callback({ state, code: '4/0AcodeFromGoogle', scope: CALENDAR_SCOPE });
  assert.equal(`${back.origin}${back.pathname}`, `${APP}/dashboard`);
  const token = back.searchParams.get('calendarConnect');
  assert.ok(token && token.length >= 32);

  // Traded with the same redirect URI, and nothing connected yet: only a grant waits for her session
  assert.equal(calls.length, 1);
  assert.equal(calls[0].form.get('grant_type'), 'authorization_code');
  assert.equal(calls[0].form.get('redirect_uri'), 'https://api.taro.test/api/auth/google/callback');
  assert.equal(connections.docs.length, 0);
  const grant = grants.docs[0];
  assert.equal(grant.userId, PRIYA);
  assert.equal(grant.companyId, COMPANY);
  assert.equal(grant.email, 'priya@northwind.dev');
  assert.notEqual(grant.refreshTokenEnc, '1//priya-refresh-token');
  // Bound to her: it decrypts for her and nobody else
  assert.equal(decryptSecret(grant.refreshTokenEnc as string, refreshTokenContext(COMPANY, PRIYA)), '1//priya-refresh-token');
  assert.throws(() => decryptSecret(grant.refreshTokenEnc as string, refreshTokenContext(COMPANY, SAM)));
  // No access token is kept anywhere
  assert.ok(!JSON.stringify(grants.docs).includes('ya29.access'));
});

test('a sign-in state on the same callback signs in, and never connects a calendar', async (t) => {
  const { grants } = stores(t);
  const calls = fakeGoogle(t, () => ({ status: 400, body: { error: 'invalid_grant' } }));
  const signIn = signToken('login:google', { r: APP, n: 'browser-nonce-0123456789' }, 600);
  const back = await callback({ state: signIn, code: '4/0AcodeFromGoogle' });
  assert.equal(`${back.origin}${back.pathname}`, `${APP}/auth/callback`);
  assert.equal(back.searchParams.get('error'), 'google_failed');
  assert.equal(calls.length, 1);
  assert.equal(grants.docs.length, 0);

  // A forged or unknown state goes nowhere near Google
  const forged = await callback({ state: `${signIn.split('.')[0]}.forged`, code: 'x' });
  assert.equal(forged.pathname, '/auth/callback');
  assert.equal(forged.searchParams.get('error'), 'expired');
  assert.equal(calls.length, 1);
});

test('an expired calendar state returns to Setup instead of the sign-in page', async (t) => {
  stores(t);
  const calls = fakeGoogle(t, () => ({ status: 500, body: {} }));
  const expired = signToken('calendar:google', { c: COMPANY, u: PRIYA, r: APP }, -1);
  const back = await callback({ state: expired, code: 'x' });
  assert.equal(`${back.origin}${back.pathname}`, `${APP}/dashboard`);
  assert.equal(back.searchParams.get('error'), 'calendar_expired');
  assert.equal(calls.length, 0);
});

test('when the person unticks the calendar box, nothing is kept and the grant is revoked', async (t) => {
  const { grants } = stores(t);
  const state = startConnecting();
  const calls = fakeGoogle(t, consentAnswer(state, 'openid https://www.googleapis.com/auth/userinfo.email'));
  const back = await callback({ state, code: '4/0AcodeFromGoogle' });
  assert.equal(back.searchParams.get('error'), 'calendar_scope');
  assert.equal(grants.docs.length, 0);
  assert.deepEqual(calls.map((c) => c.url), ['https://oauth2.googleapis.com/token', 'https://oauth2.googleapis.com/revoke']);
  assert.equal(calls[1].form.get('token'), '1//priya-refresh-token');
});

test('canceling on the consent screen says so', async (t) => {
  stores(t);
  const calls = fakeGoogle(t, () => ({ status: 500, body: {} }));
  const back = await callback({ state: startConnecting(), error: 'access_denied' });
  assert.equal(back.searchParams.get('error'), 'calendar_denied');
  assert.equal(calls.length, 0);
});

test('only the person who started connecting can redeem the grant, and reconnecting keeps their setting', async (t) => {
  const { connections } = stores(t);
  const state = startConnecting();
  fakeGoogle(t, consentAnswer(state));
  const token = (await callback({ state, code: '4/0AcodeFromGoogle' })).searchParams.get('calendarConnect')!;

  // Someone else in the workspace, holding the link, gets nothing, and the grant survives for Priya
  await assert.rejects(redeemGrant(COMPANY, SAM, token), /started by someone else/);
  await assert.rejects(redeemGrant('6a1f00000000000000000009', PRIYA, token), /started by someone else/);

  const status = await redeemGrant(COMPANY, PRIYA, token);
  assert.deepEqual(
    { connected: status.connected, email: status.email, autoJoin: status.autoJoin, joinMode: status.joinMode, needsReconnect: status.needsReconnect },
    { connected: true, email: 'priya@northwind.dev', autoJoin: true, joinMode: 'all', needsReconnect: undefined }
  );
  const conn = connections.docs[0];
  assert.equal(conn.status, 'active');
  assert.equal(decryptSecret(conn.refreshTokenEnc as string, refreshTokenContext(COMPANY, PRIYA)), '1//priya-refresh-token');
  // Single use
  await assert.rejects(redeemGrant(COMPANY, PRIYA, token), /expired/);

  // Later she picks organizer-only, Google revokes the grant, and she reconnects
  await updateSettings(COMPANY, PRIYA, { joinMode: 'organizer' });
  conn.status = 'reconnect';
  delete conn.refreshTokenEnc;
  const again = startConnecting();
  t.mock.restoreAll();
  stores(t).connections.docs.push(conn);
  fakeGoogle(t, consentAnswer(again));
  const second = (await callback({ state: again, code: '4/0AsecondCode' })).searchParams.get('calendarConnect')!;
  const reconnected = await redeemGrant(COMPANY, PRIYA, second);
  assert.equal(reconnected.needsReconnect, undefined);
  assert.equal(reconnected.joinMode, 'organizer');
});
