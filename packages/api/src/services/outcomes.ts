/**
 * How a spoken request ended, in the words Taro posts. Everything here is pure
 * and built from the copy deck, so the sentences Taro puts in Slack and the
 * dashboard can be tested without Slack, GitHub, or a database.
 */

import {
  COPY,
  cleanDashes,
  isGithubAction,
  sentence,
  slackLink,
  type ActionOutcome,
  type GithubAction,
  type IntentAction,
  type IntentParams,
  type TicketAction,
} from '@taro/shared';

export type LogStatus = 'success' | 'failed' | 'clarification_needed';

/** What the ActionLog stores for one request, and the sentence Taro posts about it. */
export interface Settled {
  status: LogStatus;
  outcome: ActionOutcome;
  summary: string;
  result?: string;
  errorMessage?: string;
  branch?: string;
}

export const done = (summary: string, extra: { result?: string; branch?: string } = {}): Settled => ({
  status: 'success',
  outcome: 'done',
  summary,
  ...extra,
});

export const needsYou = (question: string): Settled => ({
  status: 'clarification_needed',
  outcome: 'needs_you',
  summary: question,
});

// Still logged as clarification_needed, so older readers of `status` keep working.
export const turnedOff = (action: string): Settled => ({
  status: 'clarification_needed',
  outcome: 'turned_off',
  summary: COPY.turnedOff(action),
});

// Posts and checklists need Slack. Slack is optional for Google workspaces, so without it
// these are off for the workspace, the way a GitHub action it turned off is, rather than a failure.
export const slackOff = (): Settled => ({
  status: 'clarification_needed',
  outcome: 'turned_off',
  summary: COPY.slackNotConnected,
});

export const failed = (summary: string, errorMessage?: string): Settled => ({
  status: 'failed',
  outcome: 'failed',
  summary,
  ...(errorMessage ? { errorMessage } : {}),
});

/**
 * cleanDashes on every string the model wrote, before anything is posted or
 * stored. Names (channels, labels, logins) have no spaced dashes, so they pass
 * through unchanged.
 */
export function cleanParams(params: IntentParams): IntentParams {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(params)) {
    if (typeof value === 'string') {
      const clean = cleanDashes(value);
      if (clean) out[key] = clean;
    } else if (Array.isArray(value)) {
      const clean = value.map((v) => (typeof v === 'string' ? cleanDashes(v) : v)).filter((v) => v !== '');
      if (clean.length > 0) out[key] = clean;
    } else if (value !== undefined) {
      out[key] = value;
    }
  }
  return out as IntentParams;
}

/** The question Taro asks back when a request is missing something it needs, or null when nothing is. */
export function missingDetail(action: IntentAction, p: IntentParams): string | null {
  switch (action) {
    case 'unknown':
      return null;
    case 'post_message':
      return p.channel && p.message ? null : COPY.askPost;
    case 'create_todo_list':
      return p.channel && p.items?.length ? null : COPY.askChecklist;
    case 'create_github_issue':
      return p.title ? null : COPY.askIssueTitle;
    case 'create_pull_request':
      return p.title ? null : COPY.askPullTitle;
    case 'create_ticket':
      return p.title ? null : COPY.askTicketTitle;
    case 'comment_ticket':
      return !p.ticket ? COPY.askTicket : p.body ? null : COPY.askComment;
    case 'close_ticket':
    case 'reopen_ticket':
      return p.ticket ? null : COPY.askTicket;
    case 'assign_ticket':
      return !p.ticket ? COPY.askTicket : p.assignees?.length ? null : COPY.askTicketAssignee;
    case 'label_ticket':
      return !p.ticket ? COPY.askTicket : p.labels?.length ? null : COPY.askLabels;
  }
  // Everything else acts on an existing issue or pull request.
  if (!p.issueNumber) return COPY.askNumber;
  switch (action) {
    case 'comment_github':
      return p.body ? null : COPY.askComment;
    case 'label_github_issue':
      return p.labels?.length ? null : COPY.askLabels;
    case 'assign_github_issue':
      return p.assignees?.length ? null : COPY.askAssignees;
    case 'request_github_review':
      return p.reviewers?.length ? null : COPY.askReviewers;
    default:
      return null;
  }
}

// The names a GitHub summary lists: labels added, or the people assigned or asked to review.
function namesFor(action: GithubAction, p: IntentParams): string[] {
  if (action === 'label_github_issue') return p.labels ?? [];
  if (action === 'assign_github_issue') return p.assignees ?? [];
  if (action === 'request_github_review') return p.reviewers ?? [];
  return [];
}

/**
 * A GitHub request that worked. The summary links the number for Slack;
 * `result` keeps the "#12 in owner/repo: url" shape the dashboard reads links from.
 */
export function githubDone(
  action: GithubAction,
  gh: { url: string; number: number; branch?: string },
  repo: string,
  p: IntentParams
): Settled {
  const names = namesFor(action, p);
  const plain = COPY.githubDone(action, `#${gh.number}`, repo, names);
  return done(COPY.githubDone(action, slackLink(gh.url, `#${gh.number}`), repo, names), {
    result: `${plain.replace(/\.$/, '')}: ${gh.url}`,
    ...(gh.branch ? { branch: gh.branch } : {}),
  });
}

/** A GitHub request that failed. "GitHub says" only when GitHub actually answered. */
export function githubFailed(action: GithubAction, n: number | undefined, gh: { error?: string; status?: number }): Settled {
  const summary = gh.status
    ? COPY.githubFailed(action, n, gh.error)
    : `${COPY.githubCouldnt(action, n)}${gh.error?.trim() ? ` ${sentence(gh.error)}` : ''}`;
  return failed(summary, gh.error);
}

/**
 * A Linear or Jira request that worked. The summary links the key for Slack; `result` keeps
 * "Filed ENG-12 in Linear: url" for the dashboard and the webhooks.
 */
export function ticketDone(action: TicketAction, t: { key: string; url: string; names?: string[] }, tracker: string, p: IntentParams): Settled {
  const names = t.names ?? (action === 'label_ticket' ? p.labels ?? [] : action === 'assign_ticket' ? p.assignees ?? [] : []);
  const plain = COPY.ticketDone(action, t.key, tracker, names);
  return done(COPY.ticketDone(action, slackLink(t.url, t.key), tracker, names), { result: `${plain.replace(/\.$/, '')}: ${t.url}` });
}

/** A Linear or Jira request that failed. "<Tracker> says" only when it actually answered. */
export function ticketFailed(
  action: TicketAction,
  key: string | undefined,
  tracker: string,
  t: { error: string; status?: number; notFound?: boolean; reconnect?: boolean; missingPeople?: string[] }
): Settled {
  if (t.reconnect) return failed(COPY.trackerReconnect(tracker), t.error);
  if (t.missingPeople?.length) return failed(COPY.personNotFound(t.missingPeople, tracker), t.error);
  if (t.notFound && key) return failed(COPY.ticketNotFound(key, tracker), t.error);
  const summary = t.status
    ? COPY.ticketFailed(action, key, tracker, t.error)
    : `${COPY.ticketCouldnt(action, key)}${t.error?.trim() ? ` ${sentence(t.error)}` : ''}`;
  return failed(summary, t.error);
}

/** A Slack post that failed. `channel` is the name as it was asked for. */
export function slackFailed(channel: string, post: { notFound?: boolean; slackError?: string; error?: string }): Settled {
  return failed(post.notFound ? COPY.channelNotFound(channel) : COPY.slackFailed(channel, post.slackError), post.error);
}

/** A spoken command short enough to quote back, cut at a word. Transcribed dashes become commas here too. */
export function quoted(command: string, max = 120): string {
  const text = cleanDashes(command);
  if (text.length <= max) return text;
  const cut = text.slice(0, max);
  const space = cut.lastIndexOf(' ');
  return `${(space > max / 2 ? cut.slice(0, space) : cut).replace(/[\s,;:.]+$/, '')}…`;
}

export const recapLine = (outcome: ActionOutcome, command: string, summary: string) =>
  COPY.recapLine(outcome, quoted(command), summary).trim();

/**
 * How a log from before outcomes were stored ended, inferred the way the
 * dashboard does. Without the workspace's enabled actions, a refusal can't be
 * told apart from a question, so it counts as a question.
 */
export function inferOutcome(status: string | undefined, action?: string | null, enabledActions?: readonly string[]): ActionOutcome {
  if (status === 'success') return 'done';
  if (status === 'failed') return 'failed';
  return enabledActions && action && isGithubAction(action) && !enabledActions.includes(action) ? 'turned_off' : 'needs_you';
}

// Older results read "Opened issue #12 in owner/repo: https://...". Recaps link the number instead.
const LEGACY_RESULT = /(#\d+) in ([^:]+): (https?:\/\/\S+)/;

interface LoggedRequest {
  command: string;
  status: string;
  outcome?: ActionOutcome | null;
  summary?: string | null;
  result?: string | null;
  errorMessage?: string | null;
}

/** One recap line per logged request, in the order given. Older logs fall back to what they recorded. */
export function recapLines(logs: readonly LoggedRequest[]): string[] {
  return logs.map((l) => {
    const outcome = l.outcome ?? inferOutcome(l.status);
    const legacy = outcome === 'done' ? (l.result ?? '').replace(LEGACY_RESULT, '<$3|$1> in $2') : l.errorMessage ?? '';
    return recapLine(outcome, l.command, l.summary ?? sentence(legacy));
  });
}
