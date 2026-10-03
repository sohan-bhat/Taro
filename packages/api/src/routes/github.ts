/**
 * GitHub App connection. The app is one bot identity shared by every
 * workspace, so an installation ID alone proves nothing: anyone can type
 * another org's ID into the callback URL. Connecting takes two steps:
 *
 * 1. The callback uses the person's own GitHub authorization to list the
 *    installations they can access and, in each, the repos they can push to.
 *    It parks that as a short-lived grant and connects nothing.
 * 2. The dashboard redeems the grant with the session of the same person who
 *    started the flow. A link that finishes in someone else's browser is useless.
 */

import { Router, type Router as RouterType } from 'express';
import { GITHUB_CAPABILITIES } from '@taro/shared';
import { GithubConnectionModel, GithubGrantModel } from '../db/models';
import type { GrantedInstallation } from '../db/models/GithubGrant';
import { env, githubAppConfigured, githubOAuthConfigured } from '../config/env';
import { asyncHandler } from '../middleware/errorHandler';
import { requireAdmin, requireAuth, type AuthedRequest } from '../middleware/auth';
import { ValidationError } from '../lib/errors';
import { randomToken, sha256, signToken, verifyToken } from '../lib/crypto';
import { resolveReturnTo } from '../lib/origins';
import { log, errorMessage } from '../lib/logger';
import {
  exchangeUserCode,
  getInstallation,
  githubAuthorizeUrl,
  githubInstallUrl,
  listInstallationRepos,
  listUserInstallations,
  listUserPushableRepos,
} from '../services/github';

export const githubRouter: RouterType = Router();

const VALID_ACTIONS = new Set<string>(GITHUB_CAPABILITIES.map((c) => c.action));
const GRANT_TTL_MS = 15 * 60 * 1000;

async function connectInstallation(companyId: string, userId: string, grant: GrantedInstallation) {
  const installation = await getInstallation(grant.installationId);
  if (!installation.ok) throw new ValidationError('The Taro app is no longer installed on that GitHub account.');

  const existing = await GithubConnectionModel.findOne({ companyId });
  const allowed = grant.repos;
  // Keep a previously chosen repo if this person can still push to it; auto-pick when there's exactly one.
  const repo =
    existing?.repo && allowed.includes(existing.repo) ? existing.repo : allowed.length === 1 ? allowed[0] : undefined;

  await GithubConnectionModel.findOneAndUpdate(
    { companyId },
    {
      $set: {
        installationId: grant.installationId,
        accountLogin: installation.accountLogin ?? grant.accountLogin,
        allowedRepos: allowed,
        connectedByUserId: userId,
        ...(repo ? { repo } : {}),
      },
      $unset: { disconnectedAt: '', ...(repo ? {} : { repo: '' }) },
    },
    { upsert: true, new: true }
  );
  log.info(
    `[GitHub] Workspace ${companyId} connected installation ${grant.installationId} ` +
      `(${installation.accountLogin}, ${allowed.length} repo(s))`
  );
}

githubRouter.post(
  '/install-url',
  requireAuth,
  requireAdmin,
  asyncHandler(async (req: AuthedRequest, res) => {
    if (!githubAppConfigured()) {
      return res.status(503).json({ error: 'GitHub is not set up on this server.', code: 'GITHUB_APP_UNCONFIGURED' });
    }
    const mode = (req.body ?? {}).mode === 'connect' ? 'connect' : 'install';
    if (mode === 'connect' && !githubOAuthConfigured()) {
      return res.status(503).json({ error: 'Connecting an existing installation is not set up on this server.', code: 'GITHUB_OAUTH_UNCONFIGURED' });
    }
    const state = signToken(
      'github',
      { c: req.companyId, u: req.userId, r: resolveReturnTo((req.body ?? {}).returnTo) },
      15 * 60
    );
    res.json({ url: mode === 'connect' ? githubAuthorizeUrl(state) : githubInstallUrl(state) });
  })
);

// GitHub returns here after an install (Setup URL) or an authorization (Callback URL).
githubRouter.get(
  '/callback',
  asyncHandler(async (req, res) => {
    const state = verifyToken<{ c: string; u: string; r: string }>(
      'github',
      typeof req.query.state === 'string' ? req.query.state : undefined
    );
    const returnTo = resolveReturnTo(state?.r);
    const back = (query: string) => res.redirect(`${returnTo}/dashboard?${query}`);
    if (!state) return back('error=github_expired');

    const installationId = typeof req.query.installation_id === 'string' ? req.query.installation_id : '';
    const code = typeof req.query.code === 'string' ? req.query.code : '';

    try {
      let installations: GrantedInstallation[];

      if (!githubOAuthConfigured()) {
        // Without the app's OAuth credentials nothing can be verified, so this is development only.
        if (env.isProduction || !/^\d+$/.test(installationId)) {
          log.error('[GitHub] GITHUB_APP_CLIENT_ID/SECRET are not set, so installations cannot be verified.');
          return back('error=github_unverified');
        }
        log.warn('[GitHub] Development mode: trusting an unverified installation. Set GITHUB_APP_CLIENT_SECRET.');
        const installation = await getInstallation(installationId);
        if (!installation.ok) return back('error=github_failed');
        installations = [
          { installationId, accountLogin: installation.accountLogin ?? '', repos: await listInstallationRepos(installationId) },
        ];
      } else {
        if (!code) {
          // The app must have "Request user authorization (OAuth) during installation" enabled.
          return back('error=github_needs_authorization');
        }
        const userToken = await exchangeUserCode(code);
        let accessible = await listUserInstallations(userToken);
        if (installationId) {
          accessible = accessible.filter((i) => i.installationId === installationId);
          if (accessible.length === 0) {
            log.warn(`[GitHub] Workspace ${state.c} tried to connect inaccessible installation ${installationId}`);
            return back('error=github_not_yours');
          }
        }
        if (accessible.length === 0) return back('error=github_no_installations');

        installations = [];
        for (const i of accessible.slice(0, 20)) {
          const repos = await listUserPushableRepos(userToken, i.installationId);
          if (repos.length > 0) installations.push({ ...i, repos });
        }
        if (installations.length === 0) return back('error=github_no_push_access');
      }

      const token = randomToken(24);
      await GithubGrantModel.create({
        tokenHash: sha256(token),
        companyId: state.c,
        userId: state.u,
        installations,
        expiresAt: new Date(Date.now() + GRANT_TTL_MS),
      });
      return back(`githubConnect=${encodeURIComponent(token)}`);
    } catch (error) {
      log.error('[GitHub] Callback error:', errorMessage(error));
      return back('error=github_failed');
    }
  })
);

// Redeems a grant from the callback. With several accounts to choose from and no
// choice yet, it returns the choices instead of connecting.
githubRouter.post(
  '/connect',
  requireAuth,
  requireAdmin,
  asyncHandler(async (req: AuthedRequest, res) => {
    const { token, installationId } = (req.body ?? {}) as { token?: unknown; installationId?: unknown };
    if (typeof token !== 'string' || !token) throw new ValidationError('That GitHub connection expired. Connect again.');
    const grant = await GithubGrantModel.findOne({ tokenHash: sha256(token), expiresAt: { $gt: new Date() } });
    // Same workspace and the same person: someone else's browser finishing the flow gets nothing.
    if (!grant || grant.companyId !== req.companyId || grant.userId !== req.userId) {
      throw new ValidationError('That GitHub connection expired or was started by someone else. Connect again.');
    }

    let chosen: GrantedInstallation | undefined;
    if (typeof installationId === 'string' && installationId) {
      chosen = grant.installations.find((i) => i.installationId === installationId);
      if (!chosen) throw new ValidationError('Pick one of the listed accounts.');
    } else if (grant.installations.length === 1) {
      chosen = grant.installations[0];
    } else {
      return res.json({
        connected: false,
        choices: grant.installations.map((i) => ({
          installationId: i.installationId,
          accountLogin: i.accountLogin,
          repoCount: i.repos.length,
        })),
      });
    }

    // Single use: claim it before connecting so a double submit can't connect twice.
    const claimed = await GithubGrantModel.deleteOne({ _id: grant._id });
    if (claimed.deletedCount === 0) throw new ValidationError('That GitHub connection was already used.');
    await connectInstallation(req.companyId!, req.userId!, {
      installationId: chosen.installationId,
      accountLogin: chosen.accountLogin,
      repos: [...chosen.repos],
    });
    res.json({ connected: true });
  })
);

/** Repos Taro may use: granted to the app now, and pushable by whoever connected it. */
async function usableRepos(connection: { installationId: string; allowedRepos?: string[] }): Promise<string[]> {
  const allowed = new Set(connection.allowedRepos ?? []);
  if (allowed.size === 0) return [];
  return (await listInstallationRepos(connection.installationId)).filter((r) => allowed.has(r));
}

githubRouter.get(
  '/repos',
  requireAuth,
  asyncHandler(async (req: AuthedRequest, res) => {
    const connection = await GithubConnectionModel.findOne({ companyId: req.companyId });
    if (!connection?.installationId || connection.disconnectedAt) return res.json({ repos: [] });
    res.json({ repos: await usableRepos(connection) });
  })
);

githubRouter.post(
  '/repo',
  requireAuth,
  requireAdmin,
  asyncHandler(async (req: AuthedRequest, res) => {
    const repo = (req.body ?? {}).repo;
    if (typeof repo !== 'string' || !repo) throw new ValidationError('repo is required');
    const connection = await GithubConnectionModel.findOne({ companyId: req.companyId });
    if (!connection?.installationId || connection.disconnectedAt) throw new ValidationError('Connect GitHub first.');
    if (!(await usableRepos(connection)).includes(repo)) {
      throw new ValidationError(
        "Taro can't use that repository. It has to be granted to the Taro app, and whoever connected GitHub needs push access to it."
      );
    }
    connection.repo = repo;
    await connection.save();
    res.json({ repo });
  })
);

githubRouter.post(
  '/capabilities',
  requireAuth,
  requireAdmin,
  asyncHandler(async (req: AuthedRequest, res) => {
    const actions = (req.body ?? {}).actions;
    if (!Array.isArray(actions)) throw new ValidationError('actions[] is required');
    const cleaned = [...new Set(actions.filter((a): a is string => typeof a === 'string' && VALID_ACTIONS.has(a)))];
    const connection = await GithubConnectionModel.findOneAndUpdate(
      { companyId: req.companyId },
      { enabledActions: cleaned },
      { new: true }
    );
    if (!connection) throw new ValidationError('Install the Taro GitHub app first.');
    res.json({ enabledActions: cleaned });
  })
);

// Reconnects a soft-disconnected workspace with its existing, already verified installation and repos.
githubRouter.post(
  '/reconnect',
  requireAuth,
  requireAdmin,
  asyncHandler(async (req: AuthedRequest, res) => {
    const connection = await GithubConnectionModel.findOne({ companyId: req.companyId });
    if (!connection?.installationId) {
      return res.status(409).json({ error: 'Install the Taro GitHub app first.', code: 'INSTALL_NEEDED' });
    }
    const installation = await getInstallation(connection.installationId);
    if (!installation.ok) {
      await GithubConnectionModel.deleteOne({ _id: connection._id });
      return res.status(409).json({ error: 'The Taro app is no longer installed on GitHub. Install it again.', code: 'INSTALL_NEEDED' });
    }
    connection.disconnectedAt = undefined;
    if (installation.accountLogin) connection.accountLogin = installation.accountLogin;
    await connection.save();
    res.json({ connected: true });
  })
);

// Soft disconnect keeps the installation for one-click reconnect; uninstalling on GitHub fully revokes it.
githubRouter.delete(
  '/',
  requireAuth,
  requireAdmin,
  asyncHandler(async (req: AuthedRequest, res) => {
    await GithubConnectionModel.updateOne({ companyId: req.companyId }, { disconnectedAt: new Date() });
    res.json({ connected: false });
  })
);
