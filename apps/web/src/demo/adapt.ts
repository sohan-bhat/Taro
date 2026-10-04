// The frozen snapshot, read the way the dashboard reads the API (9.8): Meeting and MeetingDetail for
// the Meetings view, a read-only setup model, and the summary sentence. Pure and deterministic, so
// the prerendered page and the browser build exactly the same thing.

import {
  getLlmProvider,
  INTENTS,
  MEETING_PLATFORMS,
  type ActionLog,
  type ActionOutcome,
  type IntentAction,
  type IntentParams,
  type Meeting,
  type MeetingDetail,
  type MeetingPlatform,
  type MeetingTally,
  type ParsedIntent,
} from '@taro/shared';
import { requestOutcome } from '@/lib/requests';
import { snapshot as exported } from './snapshot';
import type { DemoLog, DemoMeeting, DemoParams, DemoSnapshot } from './types';

const DEFAULT_TIME_ZONE = 'America/Los_Angeles';

/** A meeting bot that stayed after everyone left isn't a 13 hour meeting, so the demo leaves durations over 3 hours out. */
export const MAX_DURATION_MS = 3 * 60 * 60 * 1000;

export interface DemoSetup {
  slack: { connected: boolean; teamName?: string };
  github: { connected: boolean; accountLogin?: string; repo?: string; enabledActions: string[] };
}

export interface DemoWorkspace {
  name: string;
  // After the name from 1024px, as the dashboard shows the Slack domain
  domain?: string;
  timeZone: string;
  // When the snapshot was taken. "Today" and "Yesterday" compare against it, never the real clock.
  now: number;
  // "August 29, 2026"
  savedOn: string;
  // "Pacific"
  zoneName: string;
  // Newest first
  meetings: Meeting[];
  details: Record<string, MeetingDetail>;
  // The meeting the page opens on
  featuredId?: string;
  summary: string;
  setup: DemoSetup;
}

const ACTIONS: ReadonlySet<string> = new Set(Object.values(INTENTS));
const SOURCES: ReadonlyArray<NonNullable<Meeting['source']>> = ['slack', 'dashboard', 'calendar', 'slack_command', 'extension'];
const TALLY_KEY: Record<ActionOutcome, keyof MeetingTally> = {
  done: 'done',
  needs_you: 'needsYou',
  turned_off: 'turnedOff',
  failed: 'failed',
};

const isAction = (action: string): action is IntentAction => ACTIONS.has(action);
const isPlatform = (platform?: string): platform is MeetingPlatform =>
  !!platform && Object.prototype.hasOwnProperty.call(MEETING_PLATFORMS, platform);
const isSource = (source?: string): source is NonNullable<Meeting['source']> =>
  SOURCES.includes(source as NonNullable<Meeting['source']>);
const newestFirst = (a: { createdAt: string }, b: { createdAt: string }) => Date.parse(b.createdAt) - Date.parse(a.createdAt);

function toParams(p: DemoParams = {}): IntentParams {
  const { items, labels, assignees, reviewers, ...rest } = p;
  return {
    ...rest,
    ...(items && { items: [...items] }),
    ...(labels && { labels: [...labels] }),
    ...(assignees && { assignees: [...assignees] }),
    ...(reviewers && { reviewers: [...reviewers] }),
  };
}

function toActionLog(log: DemoLog, meetingId: string): ActionLog {
  const { source } = log.intent;
  const intent: ParsedIntent = {
    action: isAction(log.intent.action) ? log.intent.action : 'unknown',
    confidence: log.intent.confidence ?? 0,
    params: toParams(log.intent.params),
    // Older logs name a model ("gemini"); only the basic matcher changes how a row reads.
    source: source === 'fallback_regex' ? source : getLlmProvider(source)?.id,
  };
  return {
    _id: log._id,
    meetingId,
    command: log.command,
    intent,
    status: log.status === 'success' || log.status === 'failed' ? log.status : 'clarification_needed',
    outcome: log.outcome,
    summary: log.summary,
    branch: log.branch,
    mode: log.mode === 'live' || log.mode === 'post_meeting' ? log.mode : undefined,
    result: log.result,
    errorMessage: log.errorMessage,
    createdAt: log.createdAt,
  };
}

// GET /api/meetings counts these per meeting. Here they're always counted from the exported requests,
// so a row agrees with its own detail even if a snapshot carries counts of its own.
function tallyOf(logs: readonly ActionLog[], enabledActions: readonly string[]): MeetingTally {
  const tally: MeetingTally = { done: 0, needsYou: 0, turnedOff: 0, failed: 0 };
  for (const log of logs) tally[TALLY_KEY[requestOutcome(log, enabledActions)]]++;
  return tally;
}

function toMeeting(m: DemoMeeting, logs: readonly ActionLog[], enabledActions: readonly string[]): Meeting {
  return {
    _id: m._id,
    meetUrl: m.meetUrl,
    platform: isPlatform(m.platform) ? m.platform : undefined,
    // Nothing on /demo is live: a meeting caught mid-call reads as over.
    status: m.status === 'error' ? 'error' : 'ended',
    source: isSource(m.source) ? m.source : undefined,
    startedByName: m.startedByName,
    slackChannelName: m.slackChannelName,
    title: m.title,
    errorCode: m.errorCode,
    errorMessage: m.errorMessage,
    tally: tallyOf(logs, enabledActions),
    transcript: m.transcript,
    liveTranscript: m.liveTranscript,
    startedAt: m.startedAt,
    endedAt: m.endedAt,
    createdAt: m.createdAt,
  };
}

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;

/**
 * "Taro joined 3 meetings here and heard 9 requests. It did 7 of them, and for the other 2 it asked a
 * question back or said why it couldn't." The second clause is left out when every request was done.
 */
export function summarize(meetings: number, requests: number, done: number): string {
  const joined = `Taro joined ${plural(meetings, 'meeting')} here`;
  if (requests === 0) return `${joined}.`;
  const did = `${joined} and heard ${plural(requests, 'request')}. It did ${done} of them`;
  return done === requests ? `${did}.` : `${did}, and for the other ${requests - done} it asked a question back or said why it couldn't.`;
}

// New exports carry the Slack team domain, which the dashboard shows as "acme.slack.com"; older ones a web domain.
const domainOf = (domain?: string) => (!domain ? undefined : domain.includes('.') ? domain : `${domain}.slack.com`);

/** "Pacific" for America/Los_Angeles, like the other US zones; anywhere else reads in full, like "Central European Time". */
function zoneNameOf(timeZone: string, at: number): string {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone, timeZoneName: 'longGeneric' }).formatToParts(at);
  const name = parts.find((p) => p.type === 'timeZoneName')?.value ?? timeZone;
  return name.replace(/^(Pacific|Mountain|Central|Eastern|Alaska|Atlantic) Time$/, '$1');
}

export function adaptSnapshot(snapshot: DemoSnapshot): DemoWorkspace {
  const timeZone = snapshot.timeZone || DEFAULT_TIME_ZONE;
  const now = Date.parse(snapshot.capturedAt);
  const enabledActions = [...snapshot.github.enabledActions];

  const meetings: Meeting[] = [];
  const details: Record<string, MeetingDetail> = {};
  for (const m of [...snapshot.meetings].sort(newestFirst)) {
    const logs = (snapshot.details[m._id]?.actionLogs ?? []).map((log) => toActionLog(log, m._id));
    // Meetings where nothing was heard or asked were test calls; they say nothing about Taro.
    if (!(m.transcript || m.liveTranscript || '').trim() && logs.length === 0) continue;
    const meeting = toMeeting(m, logs, enabledActions);
    meetings.push(meeting);
    details[m._id] = { ...meeting, actionLogs: logs };
  }

  const featured =
    meetings.find((m) => m._id === snapshot.featuredMeetingId) ?? meetings.find((m) => (m.tally?.done ?? 0) > 0) ?? meetings[0];
  const requests = meetings.reduce((n, m) => n + details[m._id].actionLogs.length, 0);
  const done = meetings.reduce((n, m) => n + (m.tally?.done ?? 0), 0);

  return {
    name: snapshot.company.name,
    domain: domainOf(snapshot.company.domain),
    timeZone,
    now,
    savedOn: new Intl.DateTimeFormat('en-US', { year: 'numeric', month: 'long', day: 'numeric', timeZone }).format(now),
    zoneName: zoneNameOf(timeZone, now),
    meetings,
    details,
    featuredId: featured?._id,
    summary: summarize(meetings.length, requests, done),
    setup: {
      slack: { connected: snapshot.slack.connected, teamName: snapshot.slack.teamName },
      github: {
        connected: snapshot.github.connected,
        accountLogin: snapshot.github.accountLogin,
        repo: snapshot.github.repo,
        enabledActions,
      },
    },
  };
}

// Checked against the types, so a change in the exporter's output shows up here at compile time.
const snapshot: DemoSnapshot = exported;

export const demo = adaptSnapshot(snapshot);
