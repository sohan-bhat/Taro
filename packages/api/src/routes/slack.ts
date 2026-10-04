import { Router, type Router as RouterType } from 'express';
import { WebClient } from '@slack/web-api';
import { CompanyModel, SlackConnectionModel, UserModel } from '../db/models';
import { env, slackConfigured } from '../config/env';
import { asyncHandler } from '../middleware/errorHandler';
import { requireAdmin, requireAuth, type AuthedRequest } from '../middleware/auth';
import { claimOwnership, linkSlackTeam, unlinkSlackTeam } from '../services/accounts';
import { signToken, verifyToken } from '../lib/crypto';
import { resolveReturnTo } from '../lib/origins';
import { log, errorMessage } from '../lib/logger';
import { SlackService, readSlackToken, sealSlackToken } from '../services/slack';

export const slackRouter: RouterType = Router();

// channels:history delivers message.channels events, which is how Taro sees meeting links.
const BOT_SCOPES = ['chat:write', 'channels:read', 'channels:join', 'channels:history', 'users:read'];
const redirectUri = () => `${env.apiUrl}/api/slack/callback`;

// The install is started from an authenticated request, so the state proves which
// workspace and person asked for it; a bare companyId in the URL would let anyone
// attach their Slack to someone else's workspace.
slackRouter.post(
  '/install-url',
  requireAuth,
  asyncHandler(async (req: AuthedRequest, res) => {
    if (!slackConfigured()) {
      return res.status(409).json({ error: "Slack isn't set up on this Taro server.", code: 'SLACK_UNAVAILABLE' });
    }
    const company = await CompanyModel.findById(req.companyId);
    // Anyone may add Taro to Slack while nobody owns the workspace; doing so is how it gets an owner.
    const unclaimed = !!company && !company.ownerClaimedAt;
    if (!unclaimed && req.role !== 'owner' && req.role !== 'admin') {
      return res.status(403).json({ error: 'Only workspace owners and admins can change this.', code: 'FORBIDDEN' });
    }
    const state = signToken(
      'slack_install',
      { c: req.companyId, u: req.userId, r: resolveReturnTo((req.body ?? {}).returnTo) },
      15 * 60
    );
    const params = new URLSearchParams({
      client_id: env.slackClientId,
      scope: BOT_SCOPES.join(','),
      redirect_uri: redirectUri(),
      state,
    });
    // Preselect the Slack workspace this Taro workspace belongs to
    if (company?.slackTeamId) params.set('team', company.slackTeamId);
    res.json({ url: `https://slack.com/oauth/v2/authorize?${params}` });
  })
);

slackRouter.get(
  '/callback',
  asyncHandler(async (req, res) => {
    const state = verifyToken<{ c: string; u: string; r: string }>(
      'slack_install',
      typeof req.query.state === 'string' ? req.query.state : undefined
    );
    const returnTo = resolveReturnTo(state?.r);
    const back = (query: string) => res.redirect(`${returnTo}/dashboard?${query}`);
    if (!state) return back('error=slack_expired');
    if (req.query.error) return back('error=slack_denied');
    if (!slackConfigured()) return back('error=slack_failed');
    const code = typeof req.query.code === 'string' ? req.query.code : '';
    if (!code) return back('error=slack_missing_code');

    try {
      const company = await CompanyModel.findById(state.c);
      if (!company) return back('error=workspace_not_found');

      const result = await new WebClient().oauth.v2.access({
        client_id: env.slackClientId,
        client_secret: env.slackClientSecret,
        code,
        redirect_uri: redirectUri(),
      });
      const teamId = result.team?.id;
      const botToken = result.access_token;
      if (!result.ok || !botToken || !teamId) {
        log.warn('[Slack] OAuth exchange failed:', result.error);
        return back('error=slack_failed');
      }
      // Undo a stray install, unless that Slack workspace already uses Taro (the token is shared)
      const undoInstall = async () => {
        if (!(await SlackConnectionModel.exists({ teamId }))) {
          await new WebClient(botToken).auth.revoke().catch(() => {});
        }
      };
      if (company.signInWith) {
        // Google workspaces take the Slack team they add Taro to, unless it's another workspace's
        const link = await linkSlackTeam(state.c, teamId);
        if (link !== 'linked') {
          await undoInstall();
          return back(link === 'taken' ? 'error=slack_team_taken' : 'error=slack_other_team');
        }
      } else if (company.slackTeamId !== teamId) {
        await undoInstall();
        return back('error=slack_team_mismatch');
      }

      await SlackConnectionModel.findOneAndUpdate(
        { teamId },
        {
          $set: {
            companyId: state.c,
            teamName: result.team?.name || company.name,
            accessToken: sealSlackToken(botToken, teamId),
            botUserId: result.bot_user_id || '',
            installedByUserId: state.u,
          },
        },
        { upsert: true, new: true }
      );

      // Whoever adds Taro to Slack owns a workspace nobody has claimed, as long as it's
      // the same person who started the install from Taro.
      const installer = await UserModel.findById(state.u).select('slackUserId companyId');
      if (installer?.slackUserId && installer.companyId === state.c && result.authed_user?.id === installer.slackUserId) {
        await claimOwnership(state.c, state.u);
      }

      // Slack only delivers channel messages to apps that are members, so join every public channel once.
      new SlackService(botToken, state.c)
        .joinAllPublicChannels()
        .then((n) => log.info(`[Slack] Joined ${n} public channel(s) in team ${teamId}`))
        .catch((error) => log.warn('[Slack] Channel auto-join failed:', errorMessage(error)));

      back('slack=connected');
    } catch (error) {
      log.error('[Slack] OAuth callback error:', errorMessage(error));
      back('error=slack_failed');
    }
  })
);

slackRouter.delete(
  '/',
  requireAuth,
  requireAdmin,
  asyncHandler(async (req: AuthedRequest, res) => {
    const connection = await SlackConnectionModel.findOne({ companyId: req.companyId });
    if (connection) {
      try {
        // Revoking the bot token removes Taro's access in Slack, not just here
        await new WebClient(readSlackToken(connection)).auth.revoke();
      } catch (error) {
        log.warn('[Slack] Token revoke failed:', errorMessage(error));
      }
      await SlackConnectionModel.deleteOne({ _id: connection._id });
    }
    // A Slack workspace keeps its team, which is who belongs to it. Any other workspace lets the team go.
    await unlinkSlackTeam(req.companyId!);
    res.json({ connected: false });
  })
);
