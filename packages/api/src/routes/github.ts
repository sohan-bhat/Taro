import { Router, type Router as RouterType } from 'express';
import { GithubConnectionModel, CompanyModel } from '../db/models';
import {
  githubAppConfigured,
  githubInstallUrl,
  getInstallation,
  listInstallationRepos,
} from '../services/github';
import { asyncHandler } from '../middleware/errorHandler';
import { requireAuth, assertCompany, type AuthedRequest } from '../middleware/auth';
import { ValidationError } from '../lib/errors';
import { env } from '../config/env';
import { GITHUB_CAPABILITIES, DEFAULT_GITHUB_ACTIONS } from '@taro/shared';

const VALID_ACTIONS = new Set(GITHUB_CAPABILITIES.map((c) => c.action));

export const githubRouter: RouterType = Router();

// Start the GitHub App installation. Like Slack's OAuth start this is a
// browser redirect, so it can't carry the bearer token; the companyId rides
// along as `state` and comes back on the setup callback.
githubRouter.get('/install', (req, res) => {
  const { companyId } = req.query;
  if (!companyId || typeof companyId !== 'string') {
    return res.status(400).json({ error: 'companyId is required' });
  }
  if (!githubAppConfigured()) {
    return res
      .status(503)
      .json({ error: 'The Taro GitHub App is not configured on this server yet.', code: 'GITHUB_APP_UNCONFIGURED' });
  }
  res.redirect(githubInstallUrl(companyId));
});

// GitHub sends the browser here after the app is installed (Setup URL)
githubRouter.get('/callback', async (req, res) => {
  const { installation_id: installationId, state: companyId } = req.query;
  const appUrl = env.appUrl;

  if (!installationId || typeof installationId !== 'string' || !companyId || typeof companyId !== 'string') {
    return res.redirect(`${appUrl}/dashboard?error=github_missing_params`);
  }

  try {
    const company = await CompanyModel.findById(companyId);
    if (!company) {
      return res.redirect(`${appUrl}/dashboard?error=company_not_found`);
    }

    const installation = await getInstallation(installationId);
    if (!installation.ok) {
      console.error('[GitHub] Installation lookup failed:', installation.error);
      return res.redirect(`${appUrl}/dashboard/${companyId}?error=github_install_failed`);
    }

    const repos = await listInstallationRepos(installationId);
    const existing = await GithubConnectionModel.findOne({ companyId });
    // Keep a previously chosen repo if it's still granted; auto-pick when
    // the company granted exactly one
    const repo =
      existing?.repo && repos.includes(existing.repo)
        ? existing.repo
        : repos.length === 1
          ? repos[0]
          : undefined;

    await GithubConnectionModel.findOneAndUpdate(
      { companyId },
      {
        $set: {
          installationId,
          accountLogin: installation.accountLogin,
          ...(repo ? { repo } : {}),
        },
        ...(repo ? {} : { $unset: { repo: '' } }),
      },
      { upsert: true, new: true }
    );

    console.log(`[GitHub] App installed for ${company.name} on ${installation.accountLogin} (${repos.length} repo(s))`);
    res.redirect(`${appUrl}/dashboard/${companyId}?github=connected`);
  } catch (error) {
    console.error('[GitHub] Callback error:', error);
    res.redirect(`${appUrl}/dashboard/${companyId}?error=github_error`);
  }
});

// Connection status for a company
githubRouter.get(
  '/status/:companyId',
  requireAuth,
  asyncHandler(async (req: AuthedRequest, res) => {
    if (!assertCompany(req, res, req.params.companyId)) return;

    const connection = await GithubConnectionModel.findOne({ companyId: req.params.companyId });
    // Soft-disconnected connections keep their installationId so we can
    // reconnect in one click without another GitHub round-trip.
    if (!connection?.installationId || connection.disconnectedAt) {
      return res.json({
        connected: false,
        configured: githubAppConfigured(),
        reconnectable: !!connection?.installationId,
      });
    }

    res.json({
      connected: true,
      configured: true,
      accountLogin: connection.accountLogin,
      repo: connection.repo,
      needsRepo: !connection.repo,
      enabledActions:
        connection.enabledActions && connection.enabledActions.length > 0
          ? connection.enabledActions
          : DEFAULT_GITHUB_ACTIONS,
      connectedAt: connection.createdAt,
    });
  })
);

// Repositories the installation can file issues in (for the picker)
githubRouter.get(
  '/repos/:companyId',
  requireAuth,
  asyncHandler(async (req: AuthedRequest, res) => {
    if (!assertCompany(req, res, req.params.companyId)) return;

    const connection = await GithubConnectionModel.findOne({ companyId: req.params.companyId });
    if (!connection?.installationId) {
      return res.json({ repos: [] });
    }
    res.json({ repos: await listInstallationRepos(connection.installationId) });
  })
);

// Choose the default repo issues are filed in
githubRouter.post(
  '/repo',
  requireAuth,
  asyncHandler(async (req: AuthedRequest, res) => {
    const { companyId, repo } = req.body as { companyId?: string; repo?: string };
    if (!companyId || !repo) {
      throw new ValidationError('companyId and repo are required');
    }
    if (!assertCompany(req, res, companyId)) return;

    const connection = await GithubConnectionModel.findOne({ companyId });
    if (!connection?.installationId) {
      throw new ValidationError('Install the Taro GitHub App first');
    }
    const repos = await listInstallationRepos(connection.installationId);
    if (!repos.includes(repo)) {
      throw new ValidationError('That repository is not granted to the Taro app. Add it in the app\'s GitHub settings.');
    }

    connection.repo = repo;
    await connection.save();
    res.json({ repo });
  })
);

// Choose which actions Taro is allowed to perform for this workspace
githubRouter.post(
  '/capabilities',
  requireAuth,
  asyncHandler(async (req: AuthedRequest, res) => {
    const { companyId, actions } = req.body as { companyId?: string; actions?: string[] };
    if (!companyId || !Array.isArray(actions)) {
      throw new ValidationError('companyId and actions[] are required');
    }
    if (!assertCompany(req, res, companyId)) return;

    const cleaned = [...new Set(actions.filter((a) => VALID_ACTIONS.has(a as never)))];
    const connection = await GithubConnectionModel.findOneAndUpdate(
      { companyId },
      { enabledActions: cleaned },
      { new: true }
    );
    if (!connection) throw new ValidationError('Install the Taro GitHub App first');
    res.json({ enabledActions: cleaned });
  })
);

// Reconnect a soft-disconnected workspace using its existing installation,
// no GitHub round-trip. Revalidates the installation still exists first.
githubRouter.post(
  '/reconnect',
  requireAuth,
  asyncHandler(async (req: AuthedRequest, res) => {
    const { companyId } = req.body as { companyId?: string };
    if (!companyId) throw new ValidationError('companyId is required');
    if (!assertCompany(req, res, companyId)) return;

    const connection = await GithubConnectionModel.findOne({ companyId });
    if (!connection?.installationId) {
      return res.status(409).json({ error: 'Install the Taro GitHub app first.', code: 'INSTALL_NEEDED' });
    }

    // If the app was actually uninstalled on GitHub, the installation is gone.
    const installation = await getInstallation(connection.installationId);
    if (!installation.ok) {
      await GithubConnectionModel.deleteOne({ companyId });
      return res.status(409).json({
        error: 'The Taro app is no longer installed on GitHub. Install it again.',
        code: 'INSTALL_NEEDED',
      });
    }

    connection.disconnectedAt = undefined;
    if (installation.accountLogin) connection.accountLogin = installation.accountLogin;
    await connection.save();
    res.json({ connected: true, repo: connection.repo, accountLogin: connection.accountLogin });
  })
);

// Soft-disconnect: keep the installation so reconnecting is one click. To fully
// revoke, the user uninstalls the Taro app from their GitHub settings.
githubRouter.delete(
  '/disconnect/:companyId',
  requireAuth,
  asyncHandler(async (req: AuthedRequest, res) => {
    if (!assertCompany(req, res, req.params.companyId)) return;
    await GithubConnectionModel.updateOne(
      { companyId: req.params.companyId },
      { disconnectedAt: new Date() }
    );
    res.json({ message: 'GitHub disconnected. Reconnect any time, or uninstall the Taro app from GitHub to fully revoke it.' });
  })
);
