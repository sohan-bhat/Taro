// How a meeting reads in the dashboard: its phase, the status words, the list row's lines,
// and the setup steps. States are always words; nothing here is a color or a dot.

import type { Meeting, MeetingTally, WorkspaceOverview } from '@taro/shared';
import { explainBotError, NOT_ADMITTED_CODES } from './bot-errors';
import { cutTail } from './live-tail';
import { ACTIVE_STATUSES, daysBefore, formatClock, formatDate, formatDay, formatDuration, whoAndWhere, type When, type Zone } from './format';

export type MeetingPhase = 'starting' | 'lobby' | 'live' | 'ended' | 'not_admitted' | 'left_early' | 'couldnt_join';

const toMs = (t: When) => (t instanceof Date ? t.getTime() : typeof t === 'number' ? t : Date.parse(t));

export function meetingPhase(m: Pick<Meeting, 'status' | 'errorCode' | 'startedAt'>): MeetingPhase {
  switch (m.status) {
    case 'pending':
      return 'starting';
    case 'joining':
      return 'lobby';
    case 'active':
      return 'live';
    case 'ended':
      return 'ended';
  }
  if (m.errorCode && NOT_ADMITTED_CODES.has(m.errorCode)) return 'not_admitted';
  return m.startedAt ? 'left_early' : 'couldnt_join';
}

/** Pending, joining, or active: the meeting is happening now. */
export const isLive = (m: Pick<Meeting, 'status'>) => ACTIVE_STATUSES.has(m.status);

/** Audio arrived in the last 15 seconds. */
export function isHearing(m: Pick<Meeting, 'status' | 'lastAudioAt'>, now: When = Date.now()): boolean {
  return m.status === 'active' && !!m.lastAudioAt && toMs(now) - Date.parse(m.lastAudioAt) < 15_000;
}

export const NO_AUDIO = 'No audio yet. If Taro is still in the lobby, admit it.';

export interface StatusPhrase {
  text: string;
  tone: 'live' | 'attention' | 'failed' | 'ended';
  // Live meetings: render <LiveClock since={clockSince} prefix="Live " /> in place of `text`
  clockSince?: string;
}

type MeetingTimes = Pick<Meeting, 'status' | 'errorCode' | 'startedAt' | 'endedAt' | 'createdAt'>;

/** The words on the right of a list row's first line: "Starting", "Live 34:12", "Ended 2:34 PM", "Couldn't join". */
export function statusPhrase(m: MeetingTimes, { now = Date.now(), ...zone }: Zone & { now?: When } = {}): StatusPhrase {
  switch (meetingPhase(m)) {
    case 'starting':
      return { text: 'Starting', tone: 'attention' };
    case 'lobby':
      return { text: 'In the lobby', tone: 'attention' };
    case 'live':
      return { text: 'Live', tone: 'live', clockSince: m.startedAt ?? m.createdAt };
    case 'ended': {
      const at = m.endedAt ?? m.startedAt ?? m.createdAt;
      const today = daysBefore(at, now, zone) === 0;
      return { text: `Ended ${today ? formatClock(at, zone) : formatDate(at, { ...zone, now })}`, tone: 'ended' };
    }
    case 'not_admitted':
      return { text: 'Not admitted', tone: 'failed' };
    case 'left_early':
      return { text: 'Left early', tone: 'failed' };
    default:
      return { text: "Couldn't join", tone: 'failed' };
  }
}

/** "Under a minute", "26 min", "1 hr 4 min"; nothing until the meeting has ended, or past `maxMs` (the demo hides runs over 3 hours). */
export function meetingDuration(m: Pick<Meeting, 'startedAt' | 'endedAt' | 'createdAt'>, maxMs?: number): string | undefined {
  if (!m.endedAt) return undefined;
  const ms = Date.parse(m.endedAt) - Date.parse(m.startedAt ?? m.createdAt);
  if (!(ms >= 0) || (maxMs !== undefined && ms > maxMs)) return undefined;
  return formatDuration(ms);
}

/**
 * A list row's second line: who and where, then the duration once ended, or the day for
 * rows from earlier days. "Ana, from #design · 26 min", "Dev, from #eng · Yesterday".
 */
export function rowLineTwo(
  m: MeetingTimes & Pick<Meeting, 'startedByName' | 'slackChannelName' | 'source'>,
  { now = Date.now(), maxDurationMs, ...zone }: Zone & { now?: When; maxDurationMs?: number } = {}
): string {
  const parts = [whoAndWhere(m, 'row', zone)];
  const duration = m.status === 'ended' ? meetingDuration(m, maxDurationMs) : undefined;
  if (duration) parts.push(duration);
  else if (m.status !== 'ended' && daysBefore(m.createdAt, now, zone) > 0) parts.push(formatDay(m.createdAt, { ...zone, now }));
  return parts.join(' · ');
}

export interface TallyPart {
  text: string;
  // Set in font-semibold text-beet
  failed: boolean;
}

/** "4 done", "2 done, 1 needed you", "3 done, 1 failed", or "Nothing asked". */
export function tallyText(t: MeetingTally): { text: string; parts: TallyPart[] } {
  const parts: TallyPart[] = [];
  if (t.done) parts.push({ text: `${t.done} done`, failed: false });
  if (t.needsYou) parts.push({ text: `${t.needsYou} needed you`, failed: false });
  if (t.turnedOff) parts.push({ text: `${t.turnedOff} turned off`, failed: false });
  if (t.failed) parts.push({ text: `${t.failed} failed`, failed: true });
  if (parts.length === 0) parts.push({ text: 'Nothing asked', failed: false });
  return { text: parts.map((p) => p.text).join(', '), parts };
}

/**
 * A list row's third line, by state. Classes per kind:
 *   note:  text-sm text-ink-2
 *   tail:  said truncate text-said-sm text-ink-2 (with heard marks)
 *   tally: text-meta text-ink-2, failed parts font-semibold text-beet
 *   error: line-clamp-2 text-sm text-ink-2
 * Ended meetings without tallies (older API) have no third line.
 */
export type LineThree =
  | { kind: 'note'; text: string }
  | { kind: 'tail'; text: string }
  | { kind: 'tally'; text: string; parts: TallyPart[] }
  | { kind: 'error'; text: string; canResend: boolean };

export function rowLineThree(
  m: MeetingTimes & Pick<Meeting, 'lastAudioAt' | 'liveTranscript' | 'tally' | 'errorMessage'>,
  { now = Date.now(), tailLength = 48 }: { now?: When; tailLength?: number } = {}
): LineThree | null {
  switch (meetingPhase(m)) {
    case 'starting':
      return { kind: 'note', text: 'Taro is on its way to the call.' };
    case 'lobby':
      return { kind: 'note', text: 'Admit Taro from the lobby to start.' };
    case 'live': {
      if (!isHearing(m, now)) return { kind: 'note', text: NO_AUDIO };
      const text = m.liveTranscript?.trim();
      return text ? { kind: 'tail', text: cutTail(text, tailLength) } : null;
    }
    case 'ended':
      return m.tally ? { kind: 'tally', ...tallyText(m.tally) } : null;
    default: {
      const error = explainBotError(m.errorCode, m.errorMessage);
      return { kind: 'error', text: error.sentence, canResend: error.canResend };
    }
  }
}

/** Pending, joining, and active first, then everything else; newest first within each. */
export function sortMeetings<T extends Pick<Meeting, 'status' | 'createdAt'>>(meetings: readonly T[]): T[] {
  return [...meetings].sort(
    (a, b) => Number(isLive(b)) - Number(isLive(a)) || Date.parse(b.createdAt) - Date.parse(a.createdAt)
  );
}

export type SetupStepId = 'slack' | 'meetingBot' | 'llm' | 'stt';

export interface SetupStep {
  id: SetupStepId;
  label: string;
  done: boolean;
}

/**
 * The required set, in its one order. `todo` drives the Setup tab ("2 to finish"), the Required
 * card header, and the default view; `next` is the row that gets the Taro rule.
 */
export function setupSteps(o: Pick<WorkspaceOverview, 'slack' | 'workspace' | 'ready'>): {
  steps: SetupStep[];
  todo: number;
  next?: SetupStepId;
} {
  const steps: SetupStep[] = [
    { id: 'slack', label: 'Slack', done: o.slack.connected && o.workspace.claimed },
    { id: 'meetingBot', label: 'Meeting bot', done: o.ready.meetingBot },
    { id: 'llm', label: 'AI model', done: o.ready.llm },
    { id: 'stt', label: 'Transcription', done: o.ready.stt },
  ];
  return { steps, todo: steps.filter((s) => !s.done).length, next: steps.find((s) => !s.done)?.id };
}

/**
 * What sending Taro still needs, in order: "a meeting bot key", "an AI model", "transcription".
 * The composer reads "Taro needs {listJoin(missing)} before it can join."
 */
export function missingToJoin(ready: WorkspaceOverview['ready']): string[] {
  const missing: string[] = [];
  if (!ready.meetingBot) missing.push('a meeting bot key');
  if (!ready.llm) missing.push('an AI model');
  if (!ready.stt) missing.push('transcription');
  return missing;
}
