/**
 * The calendar's clock, run every 30 seconds next to the stale meeting sweep. It never reads anyone's
 * calendar; it works from the occurrences invitations created:
 *
 *  1. Occurrences more than 10 minutes past their start are skipped, not joined late.
 *  2. Due occurrences are taken with one atomic update each, so two API instances never both act on
 *     one. Five minutes before the start, a scheduled bot that still fits becomes the meeting record
 *     it streams into. Without one, a bot is sent a minute before the start.
 *  3. A confirmed meeting reads "In the lobby" once its bot's join time comes.
 *  4. Occurrences whose MeetingBaas bot is out of step get synced, failures retried.
 *  5. Hourly, recurring series whose two week window has less than a day left are extended.
 */

import { CalendarOccurrenceModel, CalendarSeriesModel, CompanyModel, MeetingModel, UserModel } from '../../db/models';
import type { CalendarOccurrenceDoc } from '../../db/models/CalendarOccurrence';
import type { HydratedDocument } from 'mongoose';
import { log, errorMessage } from '../../lib/logger';
import { MeetingBaasClient, MeetingBaasError } from '../meetingbaas';
import { watchJoin } from '../joinWatcher';
import { launchMeeting, LaunchError } from '../meetingLauncher';
import { resolveProviders } from '../workspaceProviders';
import { DIRTY, syncOccurrenceBot } from './bots';
import { reconcileSeries } from './invitations';
import { botFits, dueFilter, lateFilter, planLaunch, WINDOW_MS } from './series';

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
const MAX_LAUNCHES_PER_TICK = 50;
const MAX_SYNCS_PER_TICK = 25;
const MAX_EXTENDS_PER_PASS = 200;

type Occurrence = HydratedDocument<CalendarOccurrenceDoc>;
export type Starter = (occurrence: Occurrence, now: Date) => Promise<void>;

/** Takes every due occurrence, one atomic update each, and starts it. Returns how many it took. */
export async function runDue(now: Date, start: Starter = startOccurrence): Promise<number> {
  const started: Promise<void>[] = [];
  for (let i = 0; i < MAX_LAUNCHES_PER_TICK; i++) {
    const occurrence = await CalendarOccurrenceModel.findOneAndUpdate(
      dueFilter(now),
      { $set: { status: 'launched', launchedAt: now } },
      { sort: { launchAt: 1 }, new: true }
    ).select('+bot.secretHash');
    if (!occurrence) break;
    // Meetings at the same time start side by side; one slow provider doesn't hold up the rest.
    started.push(
      start(occurrence, now).catch((error) => log.error(`[Calendar] Couldn't start occurrence ${occurrence._id}:`, errorMessage(error)))
    );
  }
  await Promise.all(started);
  return started.length;
}

/**
 * Scheduled occurrences already more than 10 minutes past their start. Their scheduled bots went in
 * on MeetingBaas's clock with nothing listening on Taro's side, so they're called back out.
 */
export async function skipLate(now: Date): Promise<number> {
  const withBots = await CalendarOccurrenceModel.find({ ...lateFilter(now), 'bot.id': { $type: 'string' } })
    .select('companyId bot')
    .limit(100);
  const result = await CalendarOccurrenceModel.updateMany(lateFilter(now), { $set: { status: 'skipped', skipReason: 'late' } });
  if (result.modifiedCount) log.warn(`[Calendar] Skipped ${result.modifiedCount} meeting(s) that started more than 10 minutes ago`);
  for (const occurrence of withBots) {
    const company = await CompanyModel.findById(occurrence.companyId);
    const key = company ? resolveProviders(company).meetingBaasKey : null;
    if (!key) continue;
    await letGo(key, occurrence.bot!.id);
    await new MeetingBaasClient(key).leave(occurrence.bot!.id).catch(() => {});
  }
  return result.modifiedCount;
}

/** A meeting Taro couldn't start still shows up, with why, instead of quietly not happening. */
async function recordFailure(occurrence: Occurrence, sponsor: { name?: string; userId?: string }, message: string, now: Date) {
  const meeting = await MeetingModel.create({
    companyId: occurrence.companyId,
    meetUrl: occurrence.meetUrl,
    platform: occurrence.platform,
    source: 'calendar',
    title: occurrence.title,
    status: 'error',
    errorMessage: message,
    startedByName: sponsor.name,
    startedByUserId: sponsor.userId,
    endedAt: now,
  });
  return meeting._id.toString();
}

async function letGo(key: string | null, botId: string) {
  if (!key) return;
  await new MeetingBaasClient(key).cancelScheduledBot(botId).catch((error) => {
    if (!(error instanceof MeetingBaasError && (error.status === 404 || error.status === 409))) {
      log.warn(`[Calendar] Couldn't cancel scheduled bot ${botId}: ${errorMessage(error)}`);
    }
  });
}

/** Confirms the occurrence's scheduled bot, or sends one, and records the meeting it became. */
export async function startOccurrence(occurrence: Occurrence, now: Date): Promise<void> {
  const id = occurrence._id;
  const series = await CalendarSeriesModel.findOne({ _id: occurrence.seriesId, companyId: occurrence.companyId });
  if (!series || series.canceledAt || series.approval !== 'approved') {
    // The series changed after this was scheduled; put it back the way the series says.
    const status = series && !series.canceledAt && series.approval === 'pending' ? 'needs_approval' : 'canceled';
    await CalendarOccurrenceModel.updateOne({ _id: id, status: 'launched' }, { ...DIRTY, $set: { ...DIRTY.$set, status }, $unset: { launchedAt: 1 } });
    return;
  }
  // Someone an owner removed can't bring Taro to meetings anymore; their series waits for approval.
  if (series.sponsorUserId && (await UserModel.exists({ _id: series.sponsorUserId, removedAt: { $exists: true } }))) {
    await CalendarSeriesModel.updateOne({ _id: series._id }, { $set: { approval: 'pending' }, $unset: { sponsorUserId: 1, sponsorName: 1 } });
    await CalendarOccurrenceModel.updateOne({ _id: id, status: 'launched' }, { ...DIRTY, $set: { ...DIRTY.$set, status: 'needs_approval' }, $unset: { launchedAt: 1 } });
    await reconcileSeries(String(series._id), now);
    return;
  }

  const company = await CompanyModel.findById(occurrence.companyId);
  if (!company) {
    await CalendarOccurrenceModel.updateOne({ _id: id }, { $set: { status: 'canceled' } });
    return;
  }
  const key = resolveProviders(company).meetingBaasKey;
  const bot = occurrence.bot;

  // Ask MeetingBaas whether the scheduled bot is still coming. Only a clear "no" sends another.
  let scheduled: 'ok' | 'gone' | 'unknown' = 'unknown';
  if (bot && key && botFits(bot, occurrence.start, occurrence.meetUrl)) {
    try {
      const status = await new MeetingBaasClient(key).scheduledBotStatus(bot.id);
      scheduled = status === 'failed' || status === 'cancelled' ? 'gone' : 'ok';
    } catch (error) {
      // A 404 under the key that made it means it's gone; under another key, MeetingBaas can't say.
      const sameKey = bot.keyHint === company.providers?.meetingBaas?.keyHint;
      if (error instanceof MeetingBaasError && error.status === 404 && sameKey) scheduled = 'gone';
    }
  }

  const plan = planLaunch(occurrence, scheduled, now);
  if (plan.kind === 'wait') {
    // No bot to confirm: send one a minute before the start instead.
    await CalendarOccurrenceModel.updateOne(
      { _id: id, status: 'launched' },
      { $set: { status: 'scheduled', launchAt: plan.until }, $unset: { launchedAt: 1, bot: 1 } }
    );
    return;
  }

  const sponsor = { name: series.sponsorName, userId: series.sponsorUserId };
  const base = {
    companyId: occurrence.companyId,
    link: { url: occurrence.meetUrl, platform: occurrence.platform },
    source: 'calendar' as const,
    title: occurrence.title,
    startedByName: sponsor.name,
    startedByUserId: sponsor.userId,
  };
  const confirming = plan.kind === 'confirm' && !!bot;
  let meetingId: string;
  try {
    const { meeting, alreadyActive } = await launchMeeting(
      confirming ? { ...base, scheduledBot: { meetingId: bot!.meetingId, botId: bot!.id, secretHash: bot!.secretHash } } : base
    );
    meetingId = meeting._id.toString();
    if (alreadyActive) {
      // Taro is already in this meeting (someone sent it another way), so the scheduled bot stays home.
      if (confirming) await letGo(key, bot!.id);
      if (!meeting.title && occurrence.title) await MeetingModel.updateOne({ _id: meeting._id }, { $set: { title: occurrence.title } });
    }
  } catch (error) {
    // Not ready, or at the workspace's limit: the scheduled bot mustn't go in on its own.
    if (confirming) await letGo(key, bot!.id);
    if (error instanceof LaunchError && error.code === 'not_found') {
      await CalendarOccurrenceModel.updateOne({ _id: id }, { $set: { status: 'canceled' } });
      return;
    }
    if (error instanceof LaunchError && error.meetingId) {
      meetingId = error.meetingId;
    } else {
      const message = error instanceof LaunchError ? error.message : "Taro couldn't join because something went wrong on its end.";
      if (!(error instanceof LaunchError)) log.error(`[Calendar] Launch failed for occurrence ${id}:`, errorMessage(error));
      meetingId = await recordFailure(occurrence, sponsor, message, now);
    }
  }
  await CalendarOccurrenceModel.updateOne({ _id: id }, { $set: { meetingId } });
}

/** Confirmed meetings move from "Starting" to "In the lobby" once their bot's join time comes. */
export async function markJoining(now: Date): Promise<number> {
  const rows = await CalendarOccurrenceModel.find({
    status: 'launched',
    'bot.joinAt': { $lte: now, $gte: new Date(now.getTime() - 15 * MINUTE) },
    meetingId: { $type: 'string' },
  })
    .select('meetingId bot')
    .limit(200);
  const ids = rows.filter((r) => r.meetingId && r.meetingId === r.bot?.meetingId).map((r) => r.meetingId!);
  if (ids.length === 0) return 0;
  const result = await MeetingModel.updateMany(
    { _id: { $in: ids }, status: 'pending' },
    { $set: { status: 'joining', joinStage: 'starting' } }
  );
  if (result.modifiedCount > 0) await watchScheduledJoins(ids);
  return result.modifiedCount;
}

/** Follows each scheduled bot from its join time until it's asking to be let in, as for an immediate one. */
async function watchScheduledJoins(ids: string[]): Promise<void> {
  const meetings = await MeetingModel.find({ _id: { $in: ids }, status: 'joining', botId: { $exists: true } }).select('companyId botId');
  const companies = new Map<string, string | null>();
  for (const meeting of meetings) {
    if (!companies.has(meeting.companyId)) {
      const company = await CompanyModel.findById(meeting.companyId);
      companies.set(meeting.companyId, company ? resolveProviders(company).meetingBaasKey : null);
    }
    const apiKey = companies.get(meeting.companyId);
    if (apiKey && meeting.botId) watchJoin({ meetingId: String(meeting._id), botId: meeting.botId, apiKey });
  }
}

/** Occurrences whose MeetingBaas bot is out of step, oldest change first, a few per tick. */
export async function syncDirtyBots(now: Date): Promise<void> {
  const rows = await CalendarOccurrenceModel.find({
    botDirty: true,
    $or: [{ botNextSyncAt: { $exists: false } }, { botNextSyncAt: { $lte: now } }],
  })
    .select('_id')
    .sort({ start: 1 })
    .limit(MAX_SYNCS_PER_TICK);
  for (const row of rows) await syncOccurrenceBot(String(row._id), now);
}

/** Recurring series whose window ends within a day get two more weeks of occurrences. */
export async function extendWindows(now: Date): Promise<number> {
  let extended = 0;
  for (; extended < MAX_EXTENDS_PER_PASS; extended++) {
    // Taking the series and moving its window is one atomic update, so each is extended once.
    const series = await CalendarSeriesModel.findOneAndUpdate(
      {
        schedule: { $type: 'string' },
        canceledAt: { $exists: false },
        approval: { $ne: 'declined' },
        expandedUntil: { $lt: new Date(now.getTime() + WINDOW_MS - DAY) },
      },
      { $set: { expandedUntil: new Date(now.getTime() + WINDOW_MS) } },
      { new: true }
    ).select('_id');
    if (!series) break;
    await reconcileSeries(String(series._id), now).catch((error) =>
      log.warn(`[Calendar] Couldn't extend series ${series._id}:`, errorMessage(error))
    );
  }
  return extended;
}

let running = false;
let lastExtendAt = 0;

/** One tick. Overlapping ticks are skipped, and each step's failure is logged without stopping the rest. */
export async function calendarTick(now = new Date()): Promise<void> {
  if (running) return;
  running = true;
  const step = (name: string, run: () => Promise<unknown>) =>
    run().catch((error) => log.warn(`[Calendar] ${name} failed:`, errorMessage(error)));
  try {
    await step('Late skip', () => skipLate(now));
    await step('Launch', () => runDue(now));
    await step('Lobby update', () => markJoining(now));
    await step('Bot sync', () => syncDirtyBots(now));
    if (now.getTime() - lastExtendAt >= HOUR) {
      lastExtendAt = now.getTime();
      await step('Window extension', () => extendWindows(now));
    }
  } finally {
    running = false;
  }
}
