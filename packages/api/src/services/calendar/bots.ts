/**
 * Keeps MeetingBaas in step with Taro's calendar. Each occurrence Taro will join gets a MeetingBaas
 * scheduled bot, which MeetingBaas prepares ahead and sends in at the start, so Taro isn't late the
 * way a bot sent at the last moment is. When the meeting moves the bot moves; when it's skipped,
 * declined, or canceled, or the workspace can't join meetings, the bot is canceled.
 *
 * Every change marks the occurrence "dirty" and bumps botRev. A sync takes a short lease on the
 * occurrence, makes MeetingBaas match it, records the bot, and clears the mark only if nothing
 * changed meanwhile. Failures are retried by the scheduler with growing gaps.
 */

import { Types } from 'mongoose';
import { CalendarOccurrenceModel, CompanyModel } from '../../db/models';
import type { CalendarOccurrenceDoc, OccurrenceBot } from '../../db/models/CalendarOccurrence';
import { env, googleCalendarConfigured } from '../../config/env';
import { calendarInvitesConfigured } from '../../lib/inviteAddress';
import { randomToken, sha256 } from '../../lib/crypto';
import { log, errorMessage } from '../../lib/logger';
import { MeetingBaasClient, MeetingBaasError } from '../meetingbaas';
import { missingSetup } from '../meetingLauncher';
import { resolveProviders } from '../workspaceProviders';
import { launchAtFor, planBot } from './series';

const LEASE_MS = 2 * 60_000;
const RETRY_MS = [60_000, 5 * 60_000, 15 * 60_000, 60 * 60_000];

/** Marks an occurrence for a fresh look by the sync. Spread into an update. */
export const DIRTY = { $set: { botDirty: true }, $inc: { botRev: 1 } } as const;

export interface BotContext {
  key: string | null;
  keyHint?: string;
  ready: boolean;
  botName: string;
}

export async function botContext(companyId: string): Promise<BotContext | null> {
  const company = await CompanyModel.findById(companyId);
  if (!company) return null;
  const providers = resolveProviders(company);
  return {
    key: providers.meetingBaasKey,
    keyHint: company.providers?.meetingBaas?.keyHint,
    ready: missingSetup(providers).length === 0,
    botName: company.botName || env.defaultBotName,
  };
}

const isStatus = (error: unknown, ...statuses: number[]) =>
  error instanceof MeetingBaasError && error.status !== undefined && statuses.includes(error.status);

interface SyncResult {
  // The bot to record: a new or moved one, null when it's gone, undefined to leave it as is
  bot?: OccurrenceBot | null;
  // False when another pass is needed (a bot was let go and a new one should follow)
  done: boolean;
  nextAt?: Date;
}

type Leased = Pick<CalendarOccurrenceDoc, 'companyId' | 'status' | 'start' | 'meetUrl' | 'bot'>;

async function syncLeased(occurrence: Leased, now: Date): Promise<SyncResult> {
  const ctx = await botContext(occurrence.companyId);
  const plan = planBot(occurrence, !!ctx?.ready && !!ctx.key, now);
  const current = occurrence.bot;
  switch (plan.kind) {
    case 'none':
      return { done: true };
    case 'later':
      return { done: false, nextAt: plan.at };
    case 'create': {
      const meetingId = new Types.ObjectId().toString();
      const secret = randomToken(32);
      const { botId } = await new MeetingBaasClient(ctx!.key!).scheduleBot({
        meetingUrl: occurrence.meetUrl,
        botName: ctx!.botName,
        meetingId,
        secret,
        joinAt: plan.joinAt,
      });
      log.info(`[Calendar] Scheduled bot ${botId} for ${plan.joinAt.toISOString()}`);
      return {
        done: true,
        bot: { id: botId, joinAt: plan.joinAt, meetUrl: occurrence.meetUrl, meetingId, secretHash: sha256(secret), keyHint: ctx!.keyHint },
      };
    }
    case 'move': {
      const client = new MeetingBaasClient(ctx!.key!);
      try {
        await client.moveScheduledBot(current!.id, { joinAt: plan.joinAt, meetingUrl: plan.meetUrl });
        return { done: true, bot: { ...current!, joinAt: plan.joinAt, meetUrl: plan.meetUrl } };
      } catch (error) {
        // Gone, or locked this close to its start: let it go, and the next pass schedules a fresh one.
        if (!isStatus(error, 404, 409)) throw error;
        await client.cancelScheduledBot(current!.id).catch(() => {});
        return { done: false, bot: null, nextAt: now };
      }
    }
    case 'release': {
      if (ctx?.key && current) {
        try {
          await new MeetingBaasClient(ctx.key).cancelScheduledBot(current.id);
        } catch (error) {
          if (isStatus(error, 409)) {
            // Too close to its start, or already sent in. Nothing more Taro can do from here.
            log.info(`[Calendar] Scheduled bot ${current.id} couldn't be canceled; MeetingBaas says it's locked or done`);
          } else if (!isStatus(error, 404)) {
            throw error;
          }
        }
      }
      return { done: true, bot: null };
    }
  }
}

/** Makes MeetingBaas match one occurrence. Safe to call from anywhere: the lease keeps it to one at a time. */
export async function syncOccurrenceBot(id: string, now = new Date()): Promise<void> {
  const leaseUntil = new Date(now.getTime() + LEASE_MS);
  const occurrence = await CalendarOccurrenceModel.findOneAndUpdate(
    { _id: id, botDirty: true, $or: [{ botLeaseUntil: { $exists: false } }, { botLeaseUntil: { $lte: now } }] },
    { $set: { botLeaseUntil: leaseUntil } },
    { new: true }
  ).select('+bot.secretHash');
  if (!occurrence) return;
  const rev = occurrence.botRev ?? 0;
  // Plain values from here: a spread Mongoose subdocument would carry its internals, not its fields.
  const leased = occurrence.toObject() as CalendarOccurrenceDoc;

  let result: SyncResult;
  try {
    result = await syncLeased(leased, now);
  } catch (error) {
    const attempts = (occurrence.botAttempts ?? 0) + 1;
    const message = error instanceof MeetingBaasError ? error.message : "MeetingBaas couldn't schedule Taro for this meeting.";
    log.warn(`[Calendar] Bot sync failed for occurrence ${id}: ${errorMessage(error)}`);
    await CalendarOccurrenceModel.updateOne(
      { _id: occurrence._id, botLeaseUntil: leaseUntil },
      {
        $set: { botError: message, botAttempts: attempts, botNextSyncAt: new Date(now.getTime() + RETRY_MS[Math.min(attempts, RETRY_MS.length) - 1]) },
        $unset: { botLeaseUntil: 1 },
      }
    );
    return;
  }

  // The bot is recorded whatever else changed meanwhile: MeetingBaas has it (or doesn't) either way.
  const bot = result.bot === undefined ? leased.bot : result.bot ?? undefined;
  await CalendarOccurrenceModel.updateOne(
    { _id: occurrence._id, botLeaseUntil: leaseUntil },
    {
      $set: {
        ...(result.bot ? { bot: result.bot } : {}),
        ...(result.nextAt ? { botNextSyncAt: result.nextAt } : {}),
      },
      $unset: {
        botLeaseUntil: 1,
        botError: 1,
        botAttempts: 1,
        ...(result.bot === null ? { bot: 1 } : {}),
      },
    }
  );
  // Done only if the occurrence is still the one this pass looked at.
  await CalendarOccurrenceModel.updateOne(
    { _id: occurrence._id, botRev: rev },
    result.done
      ? { $set: { botDirty: false, launchAt: launchAtFor(leased.start, leased.meetUrl, bot) }, $unset: { botNextSyncAt: 1 } }
      : { $set: { launchAt: launchAtFor(leased.start, leased.meetUrl, bot) } }
  );
}

/** Syncs a handful of occurrences one after another, in the background of whatever changed them. */
export function syncInBackground(ids: string[]) {
  if (ids.length === 0) return;
  (async () => {
    for (const id of ids) await syncOccurrenceBot(id).catch((error) => log.warn('[Calendar] Bot sync failed:', errorMessage(error)));
  })().catch(() => {});
}

/**
 * A workspace's keys changed. Bots made with a MeetingBaas key that's being replaced or removed are
 * canceled with that key while Taro still has it; then every upcoming occurrence gets a fresh look,
 * so a workspace that can no longer join meetings keeps no bots, and one that now can gets them.
 */
export async function providersChanged(companyId: string, replacedKey: string | null): Promise<void> {
  if (!calendarInvitesConfigured() && !googleCalendarConfigured()) return;
  const now = new Date();
  if (replacedKey) {
    const held = await CalendarOccurrenceModel.find({ companyId, 'bot.id': { $type: 'string' }, status: { $ne: 'launched' } }).select('bot');
    const client = new MeetingBaasClient(replacedKey);
    for (const occurrence of held) {
      try {
        await client.cancelScheduledBot(occurrence.bot!.id);
      } catch (error) {
        if (!isStatus(error, 404, 409)) {
          log.warn(`[Calendar] Couldn't cancel scheduled bot ${occurrence.bot!.id} with the old key: ${errorMessage(error)}`);
        }
      }
      await CalendarOccurrenceModel.updateOne({ _id: occurrence._id }, { ...DIRTY, $unset: { bot: 1 } });
    }
  }
  await CalendarOccurrenceModel.updateMany({ companyId, status: { $in: ['scheduled', 'needs_approval', 'skipped', 'canceled'] }, start: { $gt: now } }, DIRTY);
  const dirty = await CalendarOccurrenceModel.find({ companyId, botDirty: true, start: { $gt: now } }).select('_id').limit(100);
  syncInBackground(dirty.map((o) => String(o._id)));
}

/** For the providers routes: looks at the workspace's bots again after its keys change, without holding up the response. */
export function afterProvidersChange(companyId: string, replacedKey: string | null = null) {
  providersChanged(companyId, replacedKey).catch((error) => log.warn('[Calendar] Re-checking bots after a key change failed:', errorMessage(error)));
}
