/**
 * Sign in with Slack or Google (OpenID Connect). Both run the same way:
 *
 *  1. The dashboard stores a random nonce in sessionStorage and sends the
 *     browser to /<provider>/start with it.
 *  2. We sign {returnTo, nonce} into the OAuth state and redirect to the provider.
 *  3. The provider calls back; we exchange the code, check the ID token, and mint
 *     a single-use login code (2 minutes, stored hashed).
 *  4. We redirect to the dashboard's /auth/callback with the code and nonce.
 *     The dashboard only accepts it if the nonce matches what it stored, so a
 *     sign-in can't be completed in a browser that didn't start it.
 *  5. The dashboard trades the code for a session token at /exchange.
 *
 * Sign-in is authentication only: Taro asks for openid, email, and profile, and
 * never keeps a provider's access token.
 *
 * Google's callback is shared with Connect Google Calendar (services/calendar/googleConnect),
 * so the one redirect URI registered with Google serves both. The signed state's type says
 * which flow a callback finishes.
 */

import { Router, type Request, type Response, type Router as RouterType } from 'express';
import { CompanyModel, LoginCodeModel, SessionModel, UserModel } from '../db/models';
import { env, googleSignInConfigured, slackConfigured } from '../config/env';
import { asyncHandler } from '../middleware/errorHandler';
import { createSession, requireAuth, type AuthedRequest } from '../middleware/auth';
import { peekTokenType, randomToken, sha256, signToken, verifyToken } from '../lib/crypto';
import { checkGoogleIdToken, decodeJwtPayload, IdTokenRejected, oidcNonce, type Claims } from '../lib/oidc';
import { resolveReturnTo } from '../lib/origins';
import { rateLimit } from '../lib/rateLimit';
import { log, errorMessage } from '../lib/logger';
import { publicUser, publicWorkspace } from '../lib/views';
import { CALENDAR_STATE, calendarState } from '../services/calendar/googleConnect';
import { finishCalendarCallback } from './googleCalendar';
import {
  googleIdentity,
  signInWithDirectory,
  signInWithSlack,
  SignInRefused,
  type DirectoryIdentity,
  type DirectoryProvider,
} from '../services/accounts';

export const authRouter: RouterType = Router();

const authLimiter = rateLimit({ windowMs: 60_000, max: 30 });
const LOGIN_CODE_TTL_MS = 2 * 60 * 1000;
const STATE_TTL_S = 10 * 60;
const SCOPES = 'openid email profile';
const REDIRECT_URI = () => `${env.apiUrl}/api/auth/slack/callback`;

/** The dashboard's nonce for this tab, or '' when the request didn't come from the dashboard. */
function browserNonce(value: unknown): string {
  return typeof value === 'string' && /^[A-Za-z0-9_-]{16,128}$/.test(value) ? value : '';
}

async function loginCodeFor(userId: string, companyId: string): Promise<string> {
  const loginCode = randomToken(32);
  await LoginCodeModel.create({
    codeHash: sha256(loginCode),
    userId,
    companyId,
    expiresAt: new Date(Date.now() + LOGIN_CODE_TTL_MS),
  });
  return loginCode;
}

authRouter.get('/slack/start', authLimiter, (req, res) => {
  const returnTo = resolveReturnTo(req.query.returnTo);
  const nonce = browserNonce(req.query.n);
  if (!nonce) {
    return res.redirect(`${returnTo}/auth/callback?error=start_from_taro`);
  }
  if (!slackConfigured()) return res.redirect(`${returnTo}/auth/callback?error=slack_unavailable`);

  const state = signToken('login', { r: returnTo, n: nonce }, STATE_TTL_S);
  const params = new URLSearchParams({
    response_type: 'code',
    scope: SCOPES,
    client_id: env.slackClientId,
    redirect_uri: REDIRECT_URI(),
    state,
    nonce: oidcNonce(state),
  });
  // Preselect a Slack workspace when the dashboard knows which one (re-auth)
  if (typeof req.query.team === 'string' && /^[TE][A-Z0-9]{4,20}$/.test(req.query.team)) {
    params.set('team', req.query.team);
  }
  res.redirect(`https://slack.com/openid/connect/authorize?${params}`);
});

authRouter.get(
  '/slack/callback',
  authLimiter,
  asyncHandler(async (req, res) => {
    const stateParam = typeof req.query.state === 'string' ? req.query.state : '';
    const state = verifyToken<{ r: string; n: string }>('login', stateParam);
    if (!state) {
      return res.redirect(`${resolveReturnTo(undefined)}/auth/callback?error=expired`);
    }
    // Re-checked against the allowlist even though we signed it, in case the allowlist changed
    const returnTo = resolveReturnTo(state.r);
    const back = (params: Record<string, string>) =>
      res.redirect(`${returnTo}/auth/callback?${new URLSearchParams(params)}`);

    if (req.query.error) return back({ error: 'denied' });
    if (!slackConfigured()) return back({ error: 'slack_unavailable' });
    const code = typeof req.query.code === 'string' ? req.query.code : '';
    if (!code) return back({ error: 'missing_code' });

    try {
      const tokenRes = await fetch('https://slack.com/api/openid.connect.token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          code,
          client_id: env.slackClientId,
          client_secret: env.slackClientSecret,
          redirect_uri: REDIRECT_URI(),
          grant_type: 'authorization_code',
        }),
        signal: AbortSignal.timeout(15_000),
      });
      const tokens = (await tokenRes.json()) as { ok?: boolean; access_token?: string; id_token?: string; error?: string };
      if (!tokens.ok || !tokens.access_token || !tokens.id_token) {
        throw new Error(`Slack token exchange failed: ${tokens.error ?? tokenRes.status}`);
      }

      // Received directly from Slack over TLS, so the ID token's claims are trustworthy;
      // checking issuer, audience, and nonce ties it to this app and this sign-in attempt.
      const claims = decodeJwtPayload(tokens.id_token);
      if (claims.iss !== 'https://slack.com' || claims.aud !== env.slackClientId || claims.nonce !== oidcNonce(stateParam)) {
        throw new Error('ID token did not match this sign-in');
      }

      const infoRes = await fetch('https://slack.com/api/openid.connect.userInfo', {
        method: 'POST',
        headers: { Authorization: `Bearer ${tokens.access_token}` },
        signal: AbortSignal.timeout(15_000),
      });
      const info = (await infoRes.json()) as Record<string, unknown> & { ok?: boolean; error?: string };
      if (!info.ok) throw new Error(`Slack userInfo failed: ${info.error ?? infoRes.status}`);

      const teamId = String(info['https://slack.com/team_id'] ?? '');
      const userId = String(info['https://slack.com/user_id'] ?? '');
      if (!teamId || !userId || teamId !== claims['https://slack.com/team_id'] || userId !== claims['https://slack.com/user_id']) {
        throw new Error('Slack identity was incomplete or inconsistent');
      }

      const { company, user } = await signInWithSlack({
        teamId,
        teamName: String(info['https://slack.com/team_name'] ?? 'My workspace'),
        teamDomain: info['https://slack.com/team_domain'] ? String(info['https://slack.com/team_domain']) : undefined,
        userId,
        name: String(info.name ?? info.given_name ?? 'Teammate'),
        email: typeof info.email === 'string' ? info.email : undefined,
        avatarUrl: typeof info.picture === 'string' ? info.picture : undefined,
      });

      back({ code: await loginCodeFor(user._id.toString(), company._id.toString()), n: state.n });
    } catch (error) {
      if (error instanceof SignInRefused) return back({ error: error.code });
      log.warn('[Auth] Slack sign-in failed:', errorMessage(error));
      back({ error: 'slack_failed' });
    }
  })
);

// ---------------------------------------------------------------------------------------------
// Sign in with Google: the same code flow as Slack's, against Google's endpoints.

interface DirectorySignIn {
  name: string;
  configured: () => boolean;
  clientId: () => string;
  clientSecret: () => string;
  authorizeUrl: () => string;
  tokenUrl: () => string;
  // Checks the ID token and says which workspace the account belongs to
  identity: (claims: Claims, nonce: string) => DirectoryIdentity;
}

const DIRECTORY: Record<DirectoryProvider, DirectorySignIn> = {
  google: {
    name: 'Google',
    configured: googleSignInConfigured,
    clientId: () => env.googleClientId,
    clientSecret: () => env.googleClientSecret,
    authorizeUrl: () => 'https://accounts.google.com/o/oauth2/v2/auth',
    tokenUrl: () => 'https://oauth2.googleapis.com/token',
    identity: (claims, nonce) => googleIdentity(checkGoogleIdToken(claims, { clientId: env.googleClientId, nonce })),
  },
};

const directoryRedirectUri = (provider: DirectoryProvider) => `${env.apiUrl}/api/auth/${provider}/callback`;

/** What the dashboard says when the provider sent back an error instead of a code. */
function providerRefusal(provider: DirectoryProvider, error: string): string {
  return error === 'access_denied' ? `${provider}_denied` : `${provider}_error`;
}

function startDirectorySignIn(provider: DirectoryProvider) {
  return (req: Request, res: Response) => {
    const returnTo = resolveReturnTo(req.query.returnTo);
    const nonce = browserNonce(req.query.n);
    if (!nonce) return res.redirect(`${returnTo}/auth/callback?error=start_from_taro`);
    const flow = DIRECTORY[provider];
    if (!flow.configured()) return res.redirect(`${returnTo}/auth/callback?error=${provider}_unavailable`);

    // Its own typ, so a state from one provider's sign-in can't finish another's
    const state = signToken(`login:${provider}`, { r: returnTo, n: nonce }, STATE_TTL_S);
    const params = new URLSearchParams({
      response_type: 'code',
      scope: SCOPES,
      client_id: flow.clientId(),
      redirect_uri: directoryRedirectUri(provider),
      state,
      nonce: oidcNonce(state),
      // People often have a work and a personal account; let them choose instead of using whichever is signed in
      prompt: 'select_account',
    });
    res.redirect(`${flow.authorizeUrl()}?${params}`);
  };
}

function finishDirectorySignIn(provider: DirectoryProvider) {
  const flow = DIRECTORY[provider];
  return async (req: Request, res: Response) => {
    const stateParam = typeof req.query.state === 'string' ? req.query.state : '';
    const state = verifyToken<{ r: string; n: string }>(`login:${provider}`, stateParam);
    if (!state) {
      return res.redirect(`${resolveReturnTo(undefined)}/auth/callback?error=expired`);
    }
    // Re-checked against the allowlist even though we signed it, in case the allowlist changed
    const returnTo = resolveReturnTo(state.r);
    const back = (params: Record<string, string>) =>
      res.redirect(`${returnTo}/auth/callback?${new URLSearchParams(params)}`);

    if (typeof req.query.error === 'string') {
      const description = typeof req.query.error_description === 'string' ? req.query.error_description : '';
      log.info(`[Auth] ${flow.name} sign-in came back with ${req.query.error}${description ? `: ${description.slice(0, 300)}` : ''}`);
      return back({ error: providerRefusal(provider, req.query.error) });
    }
    const code = typeof req.query.code === 'string' ? req.query.code : '';
    if (!code) return back({ error: `${provider}_failed` });
    if (!flow.configured()) return back({ error: `${provider}_unavailable` });

    try {
      const tokenRes = await fetch(flow.tokenUrl(), {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
        body: new URLSearchParams({
          code,
          client_id: flow.clientId(),
          client_secret: flow.clientSecret(),
          redirect_uri: directoryRedirectUri(provider),
          grant_type: 'authorization_code',
        }),
        signal: AbortSignal.timeout(15_000),
      });
      // Only the ID token is read. The access token that comes with it is never used or kept.
      const tokens = (await tokenRes.json().catch(() => ({}))) as { id_token?: string; error?: string };
      if (!tokenRes.ok || !tokens.id_token) {
        throw new Error(`${flow.name} token exchange failed: ${tokens.error ?? tokenRes.status}`);
      }

      const identity = flow.identity(decodeJwtPayload(tokens.id_token), oidcNonce(stateParam));
      const { company, user } = await signInWithDirectory(identity);
      back({ code: await loginCodeFor(user._id.toString(), company._id.toString()), n: state.n });
    } catch (error) {
      if (error instanceof SignInRefused) return back({ error: error.code });
      if (error instanceof IdTokenRejected && error.reason === 'unverified_email') return back({ error: 'unverified_email' });
      log.warn(`[Auth] ${flow.name} sign-in failed:`, errorMessage(error));
      back({ error: `${provider}_failed` });
    }
  };
}

const finishGoogleSignIn = finishDirectorySignIn('google');

authRouter.get('/google/start', authLimiter, startDirectorySignIn('google'));
authRouter.get(
  '/google/callback',
  authLimiter,
  asyncHandler(async (req, res) => {
    const stateParam = typeof req.query.state === 'string' ? req.query.state : '';
    const calendar = calendarState(stateParam);
    if (calendar) return finishCalendarCallback(req, res, calendar, stateParam);
    // An expired calendar state goes back to Setup, not to the sign-in page
    if (peekTokenType(stateParam) === CALENDAR_STATE) {
      return res.redirect(`${resolveReturnTo(undefined)}/dashboard?error=calendar_expired`);
    }
    return finishGoogleSignIn(req, res);
  })
);

// ---------------------------------------------------------------------------------------------

authRouter.post(
  '/exchange',
  authLimiter,
  asyncHandler(async (req, res) => {
    const code = typeof req.body?.code === 'string' ? req.body.code : '';
    if (!code) return res.status(400).json({ error: 'code is required', code: 'VALIDATION_ERROR' });

    // Deleted as it's read, so a code works exactly once
    const login = await LoginCodeModel.findOneAndDelete({ codeHash: sha256(code), expiresAt: { $gt: new Date() } });
    if (!login) {
      return res.status(401).json({ error: 'That sign-in link expired. Sign in again.', code: 'LOGIN_EXPIRED' });
    }
    const token = await createSession(login.userId, login.companyId);
    res.json({ token });
  })
);

authRouter.get(
  '/session',
  requireAuth,
  asyncHandler(async (req: AuthedRequest, res) => {
    const [company, user] = await Promise.all([CompanyModel.findById(req.companyId), UserModel.findById(req.userId)]);
    if (!company || !user) {
      return res.status(401).json({ error: 'Sign in again.', code: 'SESSION_EXPIRED' });
    }
    res.json({ workspace: publicWorkspace(company), me: publicUser(user) });
  })
);

authRouter.post(
  '/logout',
  requireAuth,
  asyncHandler(async (req: AuthedRequest, res) => {
    await SessionModel.deleteOne({ _id: req.sessionId });
    res.status(204).end();
  })
);
