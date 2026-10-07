// The words of one request row: what the person said, Taro's answer, and what came of it.
// Newer logs carry `outcome` and `summary`; older ones are read from `status` and `result`.

import {
  COPY,
  DEFAULT_GITHUB_ACTIONS,
  TRACKERS,
  isGithubAction,
  isTicketAction,
  locateCommand,
  sentence,
  type ActionOutcome,
  type GithubAction,
  type IntentParams,
} from '@taro/shared';
import { listJoin } from './format';

/** The parts of an ActionLog a row reads. The demo snapshot's logs fit too. */
export interface RequestLog {
  _id?: string;
  command: string;
  status: string;
  intent: { action: string; params?: IntentParams; source?: string };
  outcome?: ActionOutcome;
  summary?: string;
  branch?: string;
  mode?: string;
  result?: string;
  errorMessage?: string;
  createdAt?: string;
}

export interface RequestView {
  // The request as the speaker said it, after the wake phrase, ending with punctuation
  said: string;
  answer: string;
  // The message Taro posted in curly quotes, the checklist items, or the issue or pull request title
  detail?: string;
  // Pull requests: the branch, set in mono
  branch?: string;
  // "View on GitHub", or for owners and admins "Change GitHub permissions" or "Set up Slack"
  link?: { label: string; href: string; external: boolean };
  outcome: ActionOutcome;
  // None for done work
  label?: { text: string; tone: 'attention' | 'neutral' | 'failed' };
  // The left rule on exception rows
  rule?: 'attention' | 'failed';
  notes: string[];
}

const RECASE: Array<[RegExp, string]> = [
  [/\bgithub\b/gi, 'GitHub'],
  // Only when it names the tracker; "linear" is an ordinary word too
  [/\b(in|to|a|the) linear\b/gi, '$1 Linear'],
  [/\bjira\b/gi, 'Jira'],
  [/\bgoogle meet\b/gi, 'Google Meet'],
  [/\bslack\b/gi, 'Slack'],
  [/\bzoom\b/gi, 'Zoom'],
  [/\bteams\b/gi, 'Teams'],
  [/\btaro\b/gi, 'Taro'],
  [/\bi\b/g, 'I'],
];

const finish = (s: string) => sentence(s.replace(/\s+/g, ' ').replace(/[\s,;:]+$/, ''));

/**
 * The request as the speaker said it: their own words and casing when the command can be found in
 * the transcript, otherwise the stored command with known names recased. Always ends with punctuation.
 */
export function displayCommand(log: Pick<RequestLog, 'command'>, transcript?: string): string {
  const hit = transcript ? locateCommand(transcript, log.command) : null;
  if (hit && transcript) return finish(transcript.slice(hit.said.start, hit.said.end));
  return finish(RECASE.reduce((s, [pattern, name]) => s.replace(pattern, name), log.command.trim()));
}

// Slack links in posted summaries ("<url|#142>") read as their text here.
function plain(summary: string): { text: string; url?: string } {
  let url: string | undefined;
  const text = summary.replace(/<((?:https?|mailto):[^|>]+)\|([^>]+)>/g, (_, href: string, label: string) => {
    url ??= href;
    return label;
  });
  return { text, url };
}

function firstSentence(s: string): [string, string | undefined] {
  const m = s.match(/^(.+?[.!?])\s+(\S[\s\S]*)$/);
  return m ? [m[1], m[2]] : [s, undefined];
}

function failureDetail(error?: string): string | undefined {
  const e = error?.trim();
  if (!e) return undefined;
  if (/^Channel ".+?" not found/.test(e)) return "Slack says there's no channel with that name.";
  if (e === 'Slack not connected') return COPY.slackNotConnected;
  if (e === 'GitHub not connected') return COPY.githubNotConnected;
  return sentence(e);
}

function namesFor(action: GithubAction, p: IntentParams): string[] {
  if (action === 'label_github_issue') return p.labels ?? [];
  if (action === 'assign_github_issue') return p.assignees ?? [];
  if (action === 'request_github_review') return p.reviewers ?? [];
  return [];
}

const capitalize = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/** How a request ended, from `outcome` or, for older logs, from `status` and the workspace's GitHub settings. */
export function requestOutcome(log: Pick<RequestLog, 'outcome' | 'status' | 'intent'>, enabledActions?: readonly string[]): ActionOutcome {
  if (log.outcome) return log.outcome;
  if (log.status === 'success') return 'done';
  if (log.status === 'failed') return 'failed';
  const enabled = enabledActions ?? DEFAULT_GITHUB_ACTIONS;
  return isGithubAction(log.intent.action) && !enabled.includes(log.intent.action) ? 'turned_off' : 'needs_you';
}

export function describeRequest(
  log: RequestLog,
  {
    enabledActions,
    live = false,
    canEdit = false,
    transcript,
  }: {
    // The workspace's GitHub actions; older logs need them to tell "turned off" from "needs you"
    enabledActions?: readonly string[];
    // While the meeting runs, exceptions read "Needs you" in Taro purple; after, "Needed you"
    live?: boolean;
    // Owners and admins get the "Change GitHub permissions" link on turned off rows
    canEdit?: boolean;
    // The meeting's transcript (or live transcript), to show the request in the speaker's words
    transcript?: string;
  } = {}
): RequestView {
  const action = log.intent.action;
  const p = log.intent.params ?? {};
  const outcome = requestOutcome(log, enabledActions);
  const summary = log.summary?.trim() ? plain(log.summary.trim()) : undefined;

  // Older Slack results: `Posted "message" to #channel` and `Created todo list (3 items) in #channel`
  const posted = log.result?.match(/^Posted "([\s\S]*)" to #(\S+)$/);
  const listed = log.result?.match(/\((\d+) items?\) in #(\S+)$/);
  const missing = log.errorMessage?.match(/^Channel "(.+?)" not found/);
  const channel = p.channel?.replace(/^#/, '') || posted?.[2] || listed?.[2] || missing?.[1];
  const slackAction = action === 'post_message' || action === 'create_todo_list';

  let answer: string;
  let detail: string | undefined;
  let branch: string | undefined;
  let link: RequestView['link'];

  if (outcome === 'done') {
    if (action === 'post_message') {
      answer = summary?.text ?? (channel ? COPY.posted(channel) : 'Posted in Slack.');
      const message = p.message ?? posted?.[1];
      detail = message ? `“${message}”` : undefined;
    } else if (action === 'create_todo_list') {
      const count = p.items?.length ?? (listed ? Number(listed[1]) : 0);
      answer = summary?.text ?? (channel && count ? COPY.postedChecklist(count, channel) : 'Posted a checklist in Slack.');
      detail = p.items?.length ? capitalize(listJoin(p.items)) : undefined;
    } else if (isGithubAction(action)) {
      // "Opened issue #142 in acme/web: https://…", which also reads older "Created issue" and "Opened PR" results
      const ref = log.result?.match(/(#\d+) in ([^:]+): (https?:\/\/\S+)/);
      answer =
        summary?.text ??
        (ref ? COPY.githubDone(action, ref[1], ref[2].trim(), namesFor(action, p)) : sentence(log.result ?? 'Done on GitHub'));
      detail = p.title;
      branch = log.branch;
      const url = ref?.[3] ?? summary?.url;
      if (url) link = { label: 'View on GitHub', href: url, external: true };
    } else if (isTicketAction(action)) {
      // "Filed ENG-12 in Linear: https://…"
      const url = log.result?.match(/: (https?:\/\/\S+)$/)?.[1] ?? summary?.url;
      answer = summary?.text ?? sentence(log.result?.replace(/: https?:\/\/\S+$/, '') ?? 'Done');
      detail = p.title;
      const tracker = p.tracker ? TRACKERS[p.tracker] : undefined;
      if (url) link = { label: tracker ? `View in ${tracker}` : 'View ticket', href: url, external: true };
    } else {
      answer = summary?.text ?? sentence(log.result ?? 'Done');
    }
  } else if (outcome === 'needs_you') {
    answer = summary?.text ?? (p.reason ? sentence(p.reason) : "Taro couldn't tell what to do with this one.");
  } else if (outcome === 'turned_off') {
    // A post or checklist is off when the workspace hasn't added Slack; anything else, by its GitHub permissions
    answer = summary?.text ?? (slackAction ? COPY.slackNotConnected : COPY.turnedOff(action));
    if (canEdit) {
      link = slackAction
        ? { label: 'Set up Slack', href: '?view=setup', external: false }
        : isTicketAction(action)
          ? { label: `Change ${p.tracker ? TRACKERS[p.tracker] : 'ticket'} permissions`, href: '?view=setup', external: false }
          : { label: 'Change GitHub permissions', href: '?view=setup&open=permissions', external: false };
    }
  } else if (summary) {
    [answer, detail] = firstSentence(summary.text);
  } else {
    answer = slackAction
      ? channel
        ? COPY.slackFailed(channel)
        : "Couldn't post in Slack."
      : isGithubAction(action)
        ? COPY.githubCouldnt(action, p.issueNumber)
        : isTicketAction(action)
          ? COPY.ticketCouldnt(action, p.ticket)
          : COPY.unexpected(log.command);
    detail = failureDetail(log.errorMessage);
  }

  const notes: string[] = [];
  if (log.mode === 'post_meeting') notes.push('Caught after the call');
  if (log.intent.source === 'fallback_regex') notes.push("The AI model didn't answer, so Taro used its basic matcher.");

  const label: RequestView['label'] =
    outcome === 'needs_you'
      ? live
        ? { text: 'Needs you', tone: 'attention' }
        : { text: 'Needed you', tone: 'neutral' }
      : outcome === 'turned_off'
        ? { text: 'Turned off', tone: live ? 'attention' : 'neutral' }
        : outcome === 'failed'
          ? { text: 'Failed', tone: 'failed' }
          : undefined;

  return {
    said: displayCommand(log, transcript),
    answer,
    detail,
    branch,
    link,
    outcome,
    label,
    rule: outcome === 'done' ? undefined : outcome === 'failed' ? 'failed' : 'attention',
    notes,
  };
}
