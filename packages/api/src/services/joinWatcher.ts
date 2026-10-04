/**
 * While a bot joins, MeetingBaas reports its progress (starting, waiting in the lobby, in the
 * call) only to account-level webhooks, which every workspace would have to set up by hand. So
 * Taro asks for the bot's status every couple of seconds until it reaches the lobby, and records
 * the stage on the meeting. The dashboard and the Meet button can then say "on its way" while the
 * bot starts, and "admit Taro" only once it's actually asking to be let in.
 */

import { MeetingModel } from '../db/models';
import { log, errorMessage } from '../lib/logger';
import { MeetingBaasClient } from './meetingbaas';

export type JoinStage = 'starting' | 'lobby';

const POLL_MS = 2_000;
// The lobby wait itself can be long; there's nothing more to show once the bot is in it
const GIVE_UP_MS = 4 * 60_000;
const MAX_FAILURES = 5;

const STARTING = new Set(['queued', 'pickup_delayed', 'joining_call']);
const LOBBY = new Set(['in_waiting_room', 'in_waiting_for_host']);

/** What a MeetingBaas status code means for joining: a stage to show, or 'done' to stop watching. */
export function stageOf(code: string | undefined): JoinStage | 'done' | undefined {
  if (!code) return undefined;
  if (STARTING.has(code)) return 'starting';
  if (LOBBY.has(code)) return 'lobby';
  // In the call (audio marks the meeting live), or finished one way or another (callbacks report it)
  return 'done';
}

interface StatusSource {
  botStatus(botId: string): Promise<string | undefined>;
}

const watching = new Map<string, NodeJS.Timeout>();

/** Watches one bot until it reaches the lobby, the call, or an end. Calling it again for the same meeting does nothing. */
export function watchJoin(
  meeting: { meetingId: string; botId: string; apiKey: string },
  opts: { source?: StatusSource; pollMs?: number; giveUpMs?: number; now?: () => number } = {}
): void {
  const { meetingId, botId } = meeting;
  if (watching.has(meetingId)) return;
  const source = opts.source ?? new MeetingBaasClient(meeting.apiKey);
  const pollMs = opts.pollMs ?? POLL_MS;
  const now = opts.now ?? Date.now;
  const giveUpAt = now() + (opts.giveUpMs ?? GIVE_UP_MS);
  let shown: JoinStage = 'starting';
  let failures = 0;

  const stop = () => {
    clearTimeout(watching.get(meetingId));
    watching.delete(meetingId);
  };
  const next = () => {
    if (now() >= giveUpAt) return stop();
    const timer = setTimeout(tick, pollMs);
    timer.unref?.();
    watching.set(meetingId, timer);
  };

  async function tick() {
    try {
      const stage = stageOf(await source.botStatus(botId));
      failures = 0;
      if (stage === 'done') return stop();
      if (stage && stage !== shown) {
        shown = stage;
        const update = stage === 'lobby' ? { joinStage: stage, lobbyAt: new Date(now()) } : { joinStage: stage };
        const result = await MeetingModel.updateOne({ _id: meetingId, status: { $in: ['pending', 'joining'] } }, { $set: update });
        // Already live, ended, or gone: nothing left to show
        if (result.matchedCount === 0) return stop();
      }
      if (stage === 'lobby') return stop();
    } catch (error) {
      if (++failures >= MAX_FAILURES) {
        log.warn(`[Join] Stopped watching meeting ${meetingId}: ${errorMessage(error)}`);
        return stop();
      }
    }
    next();
  }

  next();
}

/** For tests and shutdown. */
export function stopWatchingJoins(): void {
  for (const timer of watching.values()) clearTimeout(timer);
  watching.clear();
}
