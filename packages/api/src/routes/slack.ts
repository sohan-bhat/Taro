import { Router, type Router as RouterType } from 'express';
import { WebClient } from '@slack/web-api';
import { SlackConnectionModel, CompanyModel } from '../db/models';
import { SlackService } from '../services';
import { asyncHandler } from '../middleware/errorHandler';
import { env } from '../config/env';
import { requireAuth, assertCompany, type AuthedRequest } from '../middleware/auth';
import { encodeOAuthState, decodeOAuthState } from '../lib/oauthState';

export const slackRouter: RouterType = Router();

const getRedirectUri = () => `${env.apiUrl}/api/slack/callback`;

slackRouter.get('/install', (req, res) => {
  const { companyId, returnTo } = req.query;

  if (!companyId || typeof companyId !== 'string') {
    return res.status(400).json({ error: 'companyId is required' });
  }

  // channels:history is required for the message.channels event (auto-join)
  const scopes = ['chat:write', 'channels:read', 'channels:join', 'channels:history', 'users:read'].join(',');
  const redirectUri = getRedirectUri();
  // Carry the originating origin so the callback returns there, not localhost.
  const state = encodeOAuthState(companyId, typeof returnTo === 'string' ? returnTo : undefined);

  const installUrl = `https://slack.com/oauth/v2/authorize?client_id=${env.slackClientId}&scope=${scopes}&redirect_uri=${encodeURIComponent(redirectUri)}&state=${encodeURIComponent(state)}`;

  res.redirect(installUrl);
});

slackRouter.get('/callback', async (req, res) => {
  const { code, state } = req.query;
  const { companyId, returnTo } = decodeOAuthState(typeof state === 'string' ? state : '');
  const appUrl = returnTo || env.appUrl;

  if (!code || !companyId) {
    return res.redirect(`${appUrl}/dashboard?error=missing_params`);
  }

  try {
    const company = await CompanyModel.findById(companyId);
    if (!company) {
      return res.redirect(`${appUrl}/dashboard?error=company_not_found`);
    }

    const client = new WebClient();
    const result = await client.oauth.v2.access({
      client_id: env.slackClientId,
      client_secret: env.slackClientSecret,
      code: code as string,
      redirect_uri: getRedirectUri(),
    });

    if (!result.ok || !result.access_token || !result.team?.id) {
      console.error('Slack OAuth failed:', result.error);
      return res.redirect(`${appUrl}/dashboard?error=oauth_failed`);
    }

    // Atomic upsert to prevent race conditions when multiple callbacks arrive
    await SlackConnectionModel.findOneAndUpdate(
      { teamId: result.team.id },
      {
        $set: {
          companyId: companyId as string,
          teamName: result.team.name || '',
          accessToken: result.access_token,
          botUserId: result.bot_user_id || '',
        },
      },
      { upsert: true, new: true }
    );

    // Join public channels in the background so message.channels events
    // arrive without anyone having to /invite the bot
    new SlackService(result.access_token, companyId as string)
      .joinAllPublicChannels()
      .then((n) => console.log(`[Slack] Auto-joined ${n} public channel(s)`))
      .catch((err) => console.error('[Slack] Channel auto-join failed:', err));

    res.redirect(`${appUrl}/dashboard/${companyId}?slack=connected`);
  } catch (error) {
    console.error('Slack OAuth error:', error);
    res.redirect(`${appUrl}/dashboard?error=oauth_error`);
  }
});

slackRouter.get(
  '/status/:companyId',
  requireAuth,
  asyncHandler(async (req: AuthedRequest, res) => {
    if (!assertCompany(req, res, req.params.companyId)) return;
    const connection = await SlackConnectionModel.findOne({
      companyId: req.params.companyId,
    });

    if (!connection) {
      return res.json({ connected: false });
    }

    res.json({
      connected: true,
      teamName: connection.teamName,
      connectedAt: connection.createdAt,
    });
  })
);

slackRouter.delete(
  '/disconnect/:companyId',
  requireAuth,
  asyncHandler(async (req: AuthedRequest, res) => {
    if (!assertCompany(req, res, req.params.companyId)) return;
    await SlackConnectionModel.deleteOne({ companyId: req.params.companyId });
    res.json({ message: 'Slack disconnected' });
  })
);
