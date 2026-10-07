/**
 * Jira, through the Taro app for Jira. A Jira admin installs the app, makes a connection key on its
 * admin page, and an owner or admin here pastes it. Taro checks the key by reading the site and its
 * projects through the app before saving anything.
 */

import { Router, type Router as RouterType } from 'express';
import { TICKET_CAPABILITIES } from '@taro/shared';
import { JiraConnectionModel } from '../db/models';
import { env, jiraConfigured } from '../config/env';
import { asyncHandler } from '../middleware/errorHandler';
import { requireAdmin, requireAuth, type AuthedRequest } from '../middleware/auth';
import { ValidationError } from '../lib/errors';
import { decryptSecret, encryptSecret } from '../lib/crypto';
import { rateLimit } from '../lib/rateLimit';
import { log, errorMessage } from '../lib/logger';
import {
  JiraError,
  connectionKeyHash,
  parseConnectionKey,
  readJiraSite,
  secretContext,
  triggerContext,
  type JiraKey,
} from '../services/trackers/jira';
import { jiraStatus } from '../services/trackers/status';

export const jiraRouter: RouterType = Router();

const VALID_ACTIONS = new Set<string>(TICKET_CAPABILITIES.map((c) => c.action));

// Each check calls out to Atlassian; this keeps a stuck paste loop from hammering it.
const connectLimiter = rateLimit({
  windowMs: 60_000,
  max: 10,
  key: (req) => `jira-connect:${(req as AuthedRequest).companyId}`,
  message: 'That was a lot of tries. Wait a minute, then paste the key again.',
});

jiraRouter.get(
  '/install-url',
  requireAuth,
  requireAdmin,
  asyncHandler(async (_req, res) => {
    if (!jiraConfigured()) return res.status(404).json({ error: "Jira isn't set up on this Taro server.", code: 'NOT_CONFIGURED' });
    res.json({ url: env.jiraInstallUrl });
  })
);

async function readSite(key: JiraKey) {
  try {
    return await readJiraSite(key);
  } catch (error) {
    log.warn('[Jira] Checking a connection key failed:', errorMessage(error));
    if (error instanceof JiraError && error.kind === 'auth') {
      throw new ValidationError('The Taro app for Jira refused that key. Make a new key on its page in Jira and paste it here.');
    }
    throw new ValidationError(`Taro couldn't reach Jira with that key. ${error instanceof Error ? error.message : ''}`.trim());
  }
}

jiraRouter.post(
  '/connect',
  requireAuth,
  requireAdmin,
  connectLimiter,
  asyncHandler(async (req: AuthedRequest, res) => {
    if (!jiraConfigured()) throw new ValidationError("Jira isn't set up on this Taro server.");
    const key = parseConnectionKey((req.body ?? {}).key);
    if (!key) throw new ValidationError("That isn't a Taro connection key. Copy the whole key from the Taro app's page in Jira.");
    const site = await readSite(key);

    const companyId = req.companyId!;
    const existing = await JiraConnectionModel.findOne({ companyId });
    const sameSite = existing?.siteUrl === site.siteUrl;
    const keys = new Set(site.projects.map((p) => p.key));
    const defaultProjectKey =
      sameSite && existing?.defaultProjectKey && keys.has(existing.defaultProjectKey)
        ? existing.defaultProjectKey
        : site.projects.length === 1
          ? site.projects[0].key
          : undefined;

    const conn = await JiraConnectionModel.findOneAndUpdate(
      { companyId },
      {
        $set: {
          triggerUrlEnc: encryptSecret(key.triggerUrl, triggerContext(companyId)),
          secretEnc: encryptSecret(key.secret, secretContext(companyId)),
          keyHash: connectionKeyHash(key),
          siteUrl: site.siteUrl,
          siteName: site.siteName,
          projects: site.projects,
          connectedByUserId: req.userId,
          ...(defaultProjectKey ? { defaultProjectKey } : {}),
        },
        $unset: {
          needsReconnect: '',
          ...(defaultProjectKey ? {} : { defaultProjectKey: '' }),
          ...(sameSite ? {} : { enabledActions: '' }),
        },
      },
      { upsert: true, new: true }
    );
    log.info(`[Jira] Workspace ${companyId} connected ${site.siteUrl} (${site.projects.length} project(s))`);
    res.json({ jira: jiraStatus(conn) });
  })
);

// Projects added in Jira since connecting show up after this.
jiraRouter.post(
  '/refresh',
  requireAuth,
  requireAdmin,
  connectLimiter,
  asyncHandler(async (req: AuthedRequest, res) => {
    const conn = await JiraConnectionModel.findOne({ companyId: req.companyId });
    if (!conn) throw new ValidationError('Connect Jira first.');
    const site = await readSite({
      triggerUrl: decryptSecret(conn.triggerUrlEnc, triggerContext(conn.companyId)),
      secret: decryptSecret(conn.secretEnc, secretContext(conn.companyId)),
    });
    conn.projects = site.projects;
    conn.siteName = site.siteName;
    conn.needsReconnect = undefined;
    await conn.save();
    res.json({ jira: jiraStatus(conn) });
  })
);

jiraRouter.post(
  '/project',
  requireAuth,
  requireAdmin,
  asyncHandler(async (req: AuthedRequest, res) => {
    const projectKey = (req.body ?? {}).projectKey;
    const conn = await JiraConnectionModel.findOne({ companyId: req.companyId });
    if (!conn) throw new ValidationError('Connect Jira first.');
    if (typeof projectKey !== 'string' || !conn.projects.some((p) => p.key === projectKey)) {
      throw new ValidationError('Pick one of your Jira projects.');
    }
    conn.defaultProjectKey = projectKey;
    await conn.save();
    res.json({ jira: jiraStatus(conn) });
  })
);

jiraRouter.post(
  '/capabilities',
  requireAuth,
  requireAdmin,
  asyncHandler(async (req: AuthedRequest, res) => {
    const actions = (req.body ?? {}).actions;
    if (!Array.isArray(actions)) throw new ValidationError('actions[] is required');
    const cleaned = [...new Set(actions.filter((a): a is string => typeof a === 'string' && VALID_ACTIONS.has(a)))];
    const conn = await JiraConnectionModel.findOneAndUpdate({ companyId: req.companyId }, { enabledActions: cleaned }, { new: true });
    if (!conn) throw new ValidationError('Connect Jira first.');
    res.json({ enabledActions: cleaned });
  })
);

// Forgets the key. The app stays installed in Jira until a Jira admin removes it there.
jiraRouter.delete(
  '/',
  requireAuth,
  requireAdmin,
  asyncHandler(async (req: AuthedRequest, res) => {
    await JiraConnectionModel.deleteOne({ companyId: req.companyId });
    res.json({ jira: jiraStatus(null) });
  })
);
