/**
 * Sends Taro into a meeting. Shared by the Slack listener (a link posted in a
 * channel), the dashboard ("Send Taro to a meeting"), and calendar invitations,
 * so every path gets the same readiness checks, de-duplication, concurrency
 * cap, and error handling.
 */

import { COPY } from '@taro/shared';
import { CompanyModel, MeetingModel } from '../db/models';
import type { MeetingDoc } from '../db/models/Meeting';
import type { HydratedDocument } from 'mongoose';
import { env } from '../config/env';
import { randomToken, sha256 } from '../lib/crypto';
import { log } from '../lib/logger';
import type { MeetingLink } from '../lib/meetingUrl';
import { watchJoin } from './joinWatcher';
import { MeetingBaasClient, MeetingBaasError } from './meetingbaas';
import { resolveProviders } from './workspaceProviders';

// A meeting with no terminal event this long after creation is treated as abandoned.
const STALE_MS = 3 * 60 * 60 * 1000;
const ACTIVE = ['pending', 'joining', 'active'];

export type LaunchErrorCode = 'not_ready' | 'limit' | 'provider' | 'not_found';

export class LaunchError extends Error {
  constructor(
    message: string,
    public code: LaunchErrorCode,
    // Set when the failed meeting was recorded, so callers can point at it
    public meetingId?: string
  ) {
    super(message);
    this.name = 'LaunchError';
  }
}

export interface LaunchResult {
  meeting: HydratedDocument<MeetingDoc>;
  alreadyActive: boolean;
}

// Launches for one workspace take turns on this instance, so the duplicate check
// and the meeting cap below can't both pass for two launches at once (the same
// link posted twice, a Slack retry).
const launchQueues = new Map<string, Promise<unknown>>();

function inTurn<T>(companyId: string, run: () => Promise<T>): Promise<T> {
  const previous = launchQueues.get(companyId) ?? Promise.resolve();
  const result = previous.catch(() => {}).then(run);
  const tail = result.catch(() => {});
  launchQueues.set(companyId, tail);
  tail.then(() => {
    if (launchQueues.get(companyId) === tail) launchQueues.delete(companyId);
  });
  return result;
}

export function missingSetup(p: { meetingBaasKey: unknown; llm: unknown; stt: unknown }): string[] {
  const missing: string[] = [];
  if (!p.meetingBaasKey) missing.push('a MeetingBaas key');
  if (!p.llm) missing.push('an AI model');
  if (!p.stt) missing.push('transcription');
  return missing;
}

export async function launchMeeting(opts: {
  companyId: string;
  link: MeetingLink;
  source: 'slack' | 'dashboard' | 'extension' | 'calendar';
  slackChannelId?: string;
  slackChannelName?: string;
  slackThreadTs?: string;
  startedByName?: string;
  startedByUserId?: string;
  startedBySlackUserId?: string;
  // The calendar event's title
  title?: string;
  // A bot MeetingBaas already has scheduled for this meeting: recorded as is, not sent again
  scheduledBot?: { meetingId: string; botId: string; secretHash: string };
}): Promise<LaunchResult> {
  const company = await CompanyModel.findById(opts.companyId);
  if (!company) throw new LaunchError('Workspace not found.', 'not_found');

  const providers = resolveProviders(company);
  const missing = missingSetup(providers);
  if (missing.length > 0) {
    throw new LaunchError(COPY.notReady(missing), 'not_ready');
  }

  const secret = randomToken(32);
  // Once the pending record exists, later launches see it, so only this part needs the turn.
  const claimed = await inTurn(opts.companyId, async () => {
    // Personal meeting rooms get reused constantly, so only a recent active record blocks a new bot.
    const existing = await MeetingModel.findOne({
      companyId: opts.companyId,
      meetUrl: opts.link.url,
      status: { $in: ACTIVE },
    });
    if (existing) {
      if (Date.now() - existing.createdAt.getTime() < STALE_MS) return { existing };
      await MeetingModel.updateOne({ _id: existing._id }, { status: 'error', errorMessage: 'Abandoned' });
    }

    const activeCount = await MeetingModel.countDocuments({
      companyId: opts.companyId,
      status: { $in: ACTIVE },
      createdAt: { $gt: new Date(Date.now() - STALE_MS) },
    });
    if (activeCount >= env.maxActiveMeetingsPerWorkspace) {
      throw new LaunchError(
        `Taro is already in ${activeCount} meetings for this workspace, which is the limit. Try again when one ends.`,
        'limit'
      );
    }

    const scheduled = opts.scheduledBot;
    const created = await MeetingModel.create({
      ...(scheduled ? { _id: scheduled.meetingId, botId: scheduled.botId } : {}),
      companyId: opts.companyId,
      meetUrl: opts.link.url,
      platform: opts.link.platform,
      source: opts.source,
      title: opts.title,
      status: 'pending',
      secretHash: scheduled ? scheduled.secretHash : sha256(secret),
      slackChannelId: opts.slackChannelId,
      slackChannelName: opts.slackChannelName,
      slackThreadTs: opts.slackThreadTs,
      startedByName: opts.startedByName,
      startedByUserId: opts.startedByUserId,
      startedBySlackUserId: opts.startedBySlackUserId,
    });
    return { created };
  });
  if (claimed.existing) return { meeting: claimed.existing, alreadyActive: true };
  const meeting = claimed.created!;
  if (opts.scheduledBot) {
    log.info(`[Launcher] Scheduled bot ${opts.scheduledBot.botId} confirmed for ${opts.link.platform} meeting ${meeting._id}`);
    return { meeting, alreadyActive: false };
  }

  try {
    const client = new MeetingBaasClient(providers.meetingBaasKey!);
    const { botId } = await client.joinMeeting({
      meetingUrl: opts.link.url,
      botName: company.botName || env.defaultBotName,
      meetingId: meeting._id.toString(),
      secret,
    });
    meeting.botId = botId;
    meeting.status = 'joining';
    meeting.joinStage = 'starting';
    await meeting.save();
    watchJoin({ meetingId: meeting._id.toString(), botId, apiKey: providers.meetingBaasKey! });
    log.info(`[Launcher] Bot ${botId} joining ${opts.link.platform} meeting ${meeting._id} (${opts.source})`);
    return { meeting, alreadyActive: false };
  } catch (error) {
    const message = error instanceof MeetingBaasError ? error.message : "MeetingBaas couldn't send the bot.";
    meeting.status = 'error';
    meeting.errorMessage = message;
    await meeting.save();
    log.warn(`[Launcher] Join failed for meeting ${meeting._id}: ${error instanceof Error ? error.message : error}`);
    throw new LaunchError(message, 'provider', meeting._id.toString());
  }
}
