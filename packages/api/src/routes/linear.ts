/**
 * Linear, installed as the Taro app. Connecting takes two steps, like GitHub: the callback trades
 * Linear's code for tokens and parks them as a short-lived grant, and the dashboard redeems the grant
 * with the session of the person who started. A link finished in someone else's browser connects nothing.
 */

import { Router, type NextFunction, type Request, type Response, type Router as RouterType } from 'express';
import { TICKET_CAPABILITIES } from '@taro/shared';
import { LinearConnectionModel, LinearGrantModel } from '../db/models';
import { linearConfigured } from '../config/env';
import { asyncHandler } from '../middleware/errorHandler';
import { requireAdmin, requireAuth, type AuthedRequest } from '../middleware/auth';
import { ValidationError } from '../lib/errors';
import { decryptSecret, encryptSecret, randomToken, sha256, signToken, verifyToken } from '../lib/crypto';
import { resolveReturnTo } from '../lib/origins';
import { log, errorMessage } from '../lib/logger';
import {
  accessContext,
  exchangeLinearCode,
  linearAuthorizeUrl,
  readLinearWorkspace,
  refreshContext,
  revokeLinearToken,
  LinearService,
  type LinearTokens,
} from '../services/trackers/linear';
import { linearStatus } from '../services/trackers/status';

export const linearRouter: RouterType = Router();

const VALID_ACTIONS = new Set<string>(TICKET_CAPABILITIES.map((c) => c.action));
const GRANT_TTL_MS = 15 * 60 * 1000;
const grantContext = (companyId: string) => `linear-grant:${companyId}`;

function configured(_req: Request, res: Response, next: NextFunction) {
  if (linearConfigured()) return next();
  res.status(404).json({ error: "Linear isn't set up on this Taro server.", code: 'NOT_CONFIGURED' });
}

linearRouter.post(
  '/connect-url',
  requireAuth,
  requireAdmin,
  configured,
  asyncHandler(async (req: AuthedRequest, res) => {
    const state = signToken('linear', { c: req.companyId, u: req.userId, r: resolveReturnTo((req.body ?? {}).returnTo) }, 15 * 60);
    res.json({ url: linearAuthorizeUrl(state) });
  })
);

linearRouter.get(
  '/callback',
  asyncHandler(async (req, res) => {
    const state = verifyToken<{ c: string; u: string; r: string }>('linear', typeof req.query.state === 'string' ? req.query.state : undefined);
    const returnTo = resolveReturnTo(state?.r);
    const back = (query: string) => res.redirect(`${returnTo}/dashboard?${query}`);
    if (!state) return back('error=linear_expired');
    if (req.query.error) return back('error=linear_denied');
    const code = typeof req.query.code === 'string' ? req.query.code : '';
    if (!code || !linearConfigured()) return back('error=linear_failed');

    try {
      const tokens = await exchangeLinearCode(code);
      const token = randomToken(24);
      await LinearGrantModel.create({
        tokenHash: sha256(token),
        companyId: state.c,
        userId: state.u,
        payloadEnc: encryptSecret(JSON.stringify(tokens), grantContext(state.c)),
        expiresAt: new Date(Date.now() + GRANT_TTL_MS),
      });
      return back(`linearConnect=${encodeURIComponent(token)}`);
    } catch (error) {
      log.error('[Linear] Callback error:', errorMessage(error));
      return back('error=linear_failed');
    }
  })
);

linearRouter.post(
  '/connect',
  requireAuth,
  requireAdmin,
  configured,
  asyncHandler(async (req: AuthedRequest, res) => {
    const token = (req.body ?? {}).token;
    if (typeof token !== 'string' || !token) throw new ValidationError('That Linear connection expired. Connect again.');
    // Single use, and only for the person who started it
    const grant = await LinearGrantModel.findOneAndDelete({
      tokenHash: sha256(token),
      companyId: req.companyId,
      userId: req.userId,
      expiresAt: { $gt: new Date() },
    });
    if (!grant) throw new ValidationError('That Linear connection expired or was started by someone else. Connect again.');
    const tokens = JSON.parse(decryptSecret(grant.payloadEnc, grantContext(req.companyId!))) as LinearTokens & { expiresAt?: string };

    let workspace;
    try {
      workspace = await readLinearWorkspace(tokens.accessToken);
    } catch (error) {
      log.warn('[Linear] Reading the workspace after connecting failed:', errorMessage(error));
      throw new ValidationError("Linear connected, but Taro couldn't read its teams. Try connecting again.");
    }

    const companyId = req.companyId!;
    const existing = await LinearConnectionModel.findOne({ companyId });
    // A new install replaces the old one; its token is revoked so only one stays live
    if (existing && existing.accessTokenEnc) {
      const old = decryptSecret(existing.accessTokenEnc, accessContext(companyId));
      if (old !== tokens.accessToken) void revokeLinearToken(old);
    }
    const sameOrg = existing?.organizationId === workspace.organizationId;
    const teamIds = new Set(workspace.teams.map((t) => t.id));
    const defaultTeamId =
      sameOrg && existing?.defaultTeamId && teamIds.has(existing.defaultTeamId)
        ? existing.defaultTeamId
        : workspace.teams.length === 1
          ? workspace.teams[0].id
          : undefined;

    await LinearConnectionModel.findOneAndUpdate(
      { companyId },
      {
        $set: {
          organizationId: workspace.organizationId,
          organizationName: workspace.organizationName,
          urlKey: workspace.urlKey,
          accessTokenEnc: encryptSecret(tokens.accessToken, accessContext(companyId)),
          teams: workspace.teams,
          connectedByUserId: req.userId,
          ...(tokens.refreshToken ? { refreshTokenEnc: encryptSecret(tokens.refreshToken, refreshContext(companyId)) } : {}),
          ...(tokens.expiresAt ? { accessExpiresAt: new Date(tokens.expiresAt) } : {}),
          ...(defaultTeamId ? { defaultTeamId } : {}),
        },
        $unset: {
          needsReconnect: '',
          ...(tokens.refreshToken ? {} : { refreshTokenEnc: '' }),
          ...(tokens.expiresAt ? {} : { accessExpiresAt: '' }),
          ...(defaultTeamId ? {} : { defaultTeamId: '' }),
          ...(sameOrg ? {} : { enabledActions: '' }),
        },
      },
      { upsert: true, new: true }
    );
    log.info(`[Linear] Workspace ${companyId} connected ${workspace.organizationName} (${workspace.teams.length} team(s))`);
    res.json({ linear: linearStatus(await LinearConnectionModel.findOne({ companyId })) });
  })
);

// Teams added in Linear since connecting show up after this.
linearRouter.post(
  '/refresh',
  requireAuth,
  requireAdmin,
  asyncHandler(async (req: AuthedRequest, res) => {
    const service = await LinearService.fromCompanyId(req.companyId!);
    if (!service) throw new ValidationError('Connect Linear first.');
    const data = await service
      .query<{ teams: { nodes: Array<{ id: string; key: string; name: string }> } }>(`query { teams(first: 100) { nodes { id key name } } }`)
      .catch((error) => {
        throw new ValidationError(`Couldn't reach Linear. ${errorMessage(error)}`);
      });
    const teams = data.teams.nodes.map((t) => ({ id: t.id, key: t.key, name: t.name })).sort((a, b) => a.name.localeCompare(b.name));
    const conn = await LinearConnectionModel.findOneAndUpdate({ companyId: req.companyId }, { $set: { teams } }, { new: true });
    res.json({ linear: linearStatus(conn) });
  })
);

linearRouter.post(
  '/team',
  requireAuth,
  requireAdmin,
  asyncHandler(async (req: AuthedRequest, res) => {
    const teamId = (req.body ?? {}).teamId;
    const conn = await LinearConnectionModel.findOne({ companyId: req.companyId });
    if (!conn) throw new ValidationError('Connect Linear first.');
    if (typeof teamId !== 'string' || !conn.teams.some((t) => t.id === teamId)) throw new ValidationError('Pick one of your Linear teams.');
    conn.defaultTeamId = teamId;
    await conn.save();
    res.json({ linear: linearStatus(conn) });
  })
);

linearRouter.post(
  '/capabilities',
  requireAuth,
  requireAdmin,
  asyncHandler(async (req: AuthedRequest, res) => {
    const actions = (req.body ?? {}).actions;
    if (!Array.isArray(actions)) throw new ValidationError('actions[] is required');
    const cleaned = [...new Set(actions.filter((a): a is string => typeof a === 'string' && VALID_ACTIONS.has(a)))];
    const conn = await LinearConnectionModel.findOneAndUpdate({ companyId: req.companyId }, { enabledActions: cleaned }, { new: true });
    if (!conn) throw new ValidationError('Connect Linear first.');
    res.json({ enabledActions: cleaned });
  })
);

// Revokes Taro's access at Linear too; connecting again installs the app again.
linearRouter.delete(
  '/',
  requireAuth,
  requireAdmin,
  asyncHandler(async (req: AuthedRequest, res) => {
    const conn = await LinearConnectionModel.findOneAndDelete({ companyId: req.companyId });
    if (conn) {
      try {
        await revokeLinearToken(decryptSecret(conn.accessTokenEnc, accessContext(req.companyId!)));
      } catch (error) {
        log.warn('[Linear] Revoke on disconnect failed:', errorMessage(error));
      }
    }
    res.json({ linear: linearStatus(null) });
  })
);
