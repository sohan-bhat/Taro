/**
 * Sign in with Slack (OpenID Connect).
 *
 *  1. The dashboard stores a random nonce in sessionStorage and sends the
 *     browser to /slack/start with it.
 *  2. We sign {returnTo, nonce} into the OAuth state and redirect to Slack.
 *  3. Slack calls back; we exchange the code, verify the ID token, and mint a
 *     single-use login code (2 minutes, stored hashed).
 *  4. We redirect to the dashboard's /auth/callback with the code and nonce.
 *     The dashboard only accepts it if the nonce matches what it stored, so a
 *     sign-in can't be completed in a browser that didn't start it.
 *  5. The dashboard trades the code for a session token at /exchange.
 */

import { Router, type Router as RouterType } from 'express';
import { CompanyModel, LoginCodeModel, SessionModel, UserModel } from '../db/models';
import { env } from '../config/env';
import { asyncHandler } from '../middleware/errorHandler';
import { createSession, requireAuth, type AuthedRequest } from '../middleware/auth';
import { randomToken, sha256, signToken, verifyToken } from '../lib/crypto';
import { resolveReturnTo } from '../lib/origins';
import { rateLimit } from '../lib/rateLimit';
import { log, errorMessage } from '../lib/logger';
import { publicUser, publicWorkspace } from '../lib/views';
import { signInWithSlack, SignInRefused } from '../services/accounts';

export const authRouter: RouterType = Router();

const authLimiter = rateLimit({ windowMs: 60_000, max: 30 });
const LOGIN_CODE_TTL_MS = 2 * 60 * 1000;
const REDIRECT_URI = () => `${env.apiUrl}/api/auth/slack/callback`;

// Derived from the signed state, so the OIDC nonce needs no server-side storage.
const oidcNonce = (state: string) => sha256(`oidc:${state}`).slice(0, 32);

function decodeJwtPayload(jwt: string): Record<string, unknown> {
  const part = jwt.split('.')[1];
  if (!part) throw new Error('Malformed ID token');
  return JSON.parse(Buffer.from(part, 'base64url').toString('utf8')) as Record<string, unknown>;
}

authRouter.get('/slack/start', authLimiter, (req, res) => {
  const returnTo = resolveReturnTo(req.query.returnTo);
  const nonce = typeof req.query.n === 'string' && /^[A-Za-z0-9_-]{16,128}$/.test(req.query.n) ? req.query.n : '';
  if (!nonce) {
    return res.redirect(`${returnTo}/auth/callback?error=start_from_taro`);
  }

  const state = signToken('login', { r: returnTo, n: nonce }, 10 * 60);
  const params = new URLSearchParams({
    response_type: 'code',
    scope: 'openid email profile',
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

      const loginCode = randomToken(32);
      await LoginCodeModel.create({
        codeHash: sha256(loginCode),
        userId: user._id.toString(),
        companyId: company._id.toString(),
        expiresAt: new Date(Date.now() + LOGIN_CODE_TTL_MS),
      });
      back({ code: loginCode, n: state.n });
    } catch (error) {
      if (error instanceof SignInRefused) return back({ error: error.code });
      log.warn('[Auth] Slack sign-in failed:', errorMessage(error));
      back({ error: 'slack_failed' });
    }
  })
);

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
