/**
 * Runs one spoken request: works out what was asked, does it in Slack,
 * GitHub, Linear, or Jira, and logs how it went. Shared by the realtime pipeline (mid-meeting)
 * and the end-of-call sweep. Every sentence it returns or stores comes from
 * the copy deck, through ./outcomes.
 */

import {
  COPY,
  DEFAULT_GITHUB_ACTIONS,
  INTENTS,
  TRACKERS,
  isGithubAction,
  isTicketAction,
  sentence,
  type ActionOutcome,
  type GithubAction,
  type IntentParams,
  type ParsedIntent,
  type TicketAction,
} from '@taro/shared';
import { ActionLogModel, GithubConnectionModel, SlackConnectionModel } from '../db/models';
import { log, errorMessage } from '../lib/logger';
import { SlackService, normalizeChannel } from './slack';
import { GithubService, type GithubResult } from './github';
import { parseIntent } from './intent';
import { emitWebhookEvent } from './webhooks/dispatcher';
import { requestCompletedData } from './webhooks/events';
import type { LlmConfig } from './llm';
import { anyTracker, chooseTracker, describeTools, loadTrackers, normalizeTicketKey, type Tracker, type Trackers } from './trackers';
import {
  cleanParams,
  done,
  failed,
  githubDone,
  githubFailed,
  missingDetail,
  needsYou,
  quoted,
  slackFailed,
  slackOff,
  ticketDone,
  ticketFailed,
  turnedOff,
  type Settled,
} from './outcomes';

export interface ExecutionResult {
  status: Settled['status'];
  outcome: ActionOutcome;
  /** The sentence Taro posts in the meeting's Slack thread */
  summary: string;
}

export async function executeCommand(
  meetingId: string,
  companyId: string,
  command: string,
  mode: 'live' | 'post_meeting',
  meetingContext: string | undefined,
  llm: LlmConfig | null
): Promise<ExecutionResult> {
  let intent: ParsedIntent = { action: INTENTS.UNKNOWN, confidence: 0, params: {} };
  let settled: Settled;
  try {
    const { trackers, tools } = await connectedTools(companyId);
    const parsed = await parseIntent(command, meetingContext, llm, tools);
    intent = { ...parsed, params: cleanParams(parsed.params) };
    log.debug(`[Executor:${mode}] Parsed intent:`, JSON.stringify(intent));
    settled = await perform(companyId, command, intent, trackers);
  } catch (error) {
    log.error(`[Executor:${mode}] Command execution error:`, error);
    settled = failed(COPY.unexpected(quoted(command)), errorMessage(error));
  }

  try {
    await ActionLogModel.create({
      meetingId,
      companyId,
      command,
      intent,
      mode,
      status: settled.status,
      outcome: settled.outcome,
      summary: settled.summary,
      result: settled.result,
      errorMessage: settled.errorMessage,
      branch: settled.branch,
    });
  } catch (error) {
    // The thread still hears how it went, even if the dashboard won't.
    log.error(`[Executor:${mode}] Could not save the action log:`, errorMessage(error));
  }

  // Queued, not sent: a slow receiver never holds up the meeting
  void emitWebhookEvent(
    companyId,
    'request.completed',
    requestCompletedData(meetingId, { command, intent, outcome: settled.outcome, summary: settled.summary, result: settled.result, createdAt: new Date() })
  );

  return { status: settled.status, outcome: settled.outcome, summary: settled.summary };
}

/** What the workspace has connected: the trackers to act in, and one line telling the model. */
async function connectedTools(companyId: string): Promise<{ trackers: Trackers; tools?: string }> {
  try {
    const [trackers, slack, github] = await Promise.all([
      loadTrackers(companyId),
      SlackConnectionModel.exists({ companyId }),
      GithubConnectionModel.findOne({ companyId }, 'repo disconnectedAt'),
    ]);
    const repo = github && !github.disconnectedAt ? github.repo ?? 'no repository chosen' : undefined;
    return { trackers, tools: describeTools({ slack: !!slack, github: repo, trackers }) };
  } catch (error) {
    // The request still runs; the model just routes it without knowing what's connected
    log.warn('[Executor] Could not read the connected tools:', errorMessage(error));
    return { trackers: {} };
  }
}

/**
 * Does what was asked. A request can land somewhere other than where it was parsed: an issue goes
 * to Linear or Jira when GitHub isn't connected, and a ticket to GitHub when no tracker is. `intent`
 * is updated to say where it went, so the log and the dashboard match what happened.
 */
async function perform(companyId: string, command: string, intent: ParsedIntent, trackers: Trackers): Promise<Settled> {
  const { action, params: p } = intent;
  if (action === INTENTS.UNKNOWN) return needsYou(p.reason ? sentence(p.reason) : COPY.heardUnclear(quoted(command)));

  if (action === INTENTS.POST_MESSAGE || action === INTENTS.CREATE_TODO_LIST) {
    const question = missingDetail(action, p);
    if (question) return needsYou(question);
    const slack = await SlackService.fromCompanyId(companyId);
    if (!slack) return slackOff();

    // The name as it was asked for, for "Couldn't post in #..."
    const asked = normalizeChannel(p.channel!) || p.channel!.replace(/^#/, '');
    if (action === INTENTS.POST_MESSAGE) {
      const post = await slack.postMessage(asked, p.message!);
      if (!post.success || !post.channel) return slackFailed(asked, post);
      return done(COPY.posted(post.channel), { result: `Posted "${p.message}" to #${post.channel}` });
    }
    const items = p.items!;
    const post = await slack.postMessage(asked, COPY.checklist(p.title, items));
    if (!post.success || !post.channel) return slackFailed(asked, post);
    return done(COPY.postedChecklist(items.length, post.channel), {
      result: `Created todo list (${items.length} items) in #${post.channel}`,
    });
  }

  if (isTicketAction(action)) {
    if (!anyTracker(trackers)) {
      if (action === 'create_ticket') {
        const github = await GithubService.fromCompanyId(companyId);
        if (github) {
          intent.action = INTENTS.CREATE_GITHUB_ISSUE;
          delete p.tracker;
          return performGithub(github, 'create_github_issue', p);
        }
      }
      return failed(COPY.noTracker, 'No ticket tracker connected');
    }
    return performTicket(action, p, trackers);
  }

  if (!isGithubAction(action)) return needsYou(COPY.heardUnclear(quoted(command)));
  const github = await GithubService.fromCompanyId(companyId);
  if (!github) {
    if (action === INTENTS.CREATE_GITHUB_ISSUE && anyTracker(trackers)) {
      intent.action = INTENTS.CREATE_TICKET;
      return performTicket('create_ticket', p, trackers);
    }
    return failed(COPY.githubNotConnected, 'GitHub not connected');
  }
  return performGithub(github, action, p);
}

async function performGithub(github: GithubService, action: GithubAction, p: IntentParams): Promise<Settled> {
  // The workspace's own policy, inside whatever the GitHub App may technically do
  if (!(github.enabledActions ?? DEFAULT_GITHUB_ACTIONS).includes(action)) return turnedOff(action);
  if (!github.repo) return failed(COPY.noRepository, 'No repository selected');
  const question = missingDetail(action, p);
  if (question) return needsYou(question);

  const gh = await runGithub(github, action, p);
  return gh.success ? githubDone(action, gh, github.repo, p) : githubFailed(action, p.issueNumber, gh);
}

/** A ticket request, in the tracker it belongs to. Stores which one in `p.tracker` and the full key in `p.ticket`. */
async function performTicket(action: TicketAction, p: IntentParams, trackers: Trackers): Promise<Settled> {
  const { tracker, named } = chooseTracker(p, trackers);
  if (!tracker) return failed(COPY.trackerNotConnected(TRACKERS[named ?? 'linear']), `${TRACKERS[named ?? 'linear']} not connected`);
  p.tracker = tracker.id;
  if (!tracker.enabledActions.includes(action)) return turnedOff(action);
  const question = missingDetail(action, p);
  if (question) return needsYou(question);

  let key: string | undefined;
  if (action === 'create_ticket') {
    if (!tracker.defaultSpaceKey) return failed(COPY.noTrackerSpace(tracker.name), 'No team or project chosen for new tickets');
  } else {
    key = normalizeTicketKey(p.ticket, tracker.defaultSpaceKey) ?? undefined;
    if (!key) return needsYou(COPY.askTicket);
    p.ticket = key;
  }
  const result = await runTicket(tracker, action, p, key!);
  return result.success ? ticketDone(action, result, tracker.name, p) : ticketFailed(action, key, tracker.name, result);
}

// missingDetail has already checked every field used here; `key` is set for everything but create.
function runTicket(tracker: Tracker, action: TicketAction, p: IntentParams, key: string) {
  switch (action) {
    case 'create_ticket':
      return tracker.createTicket(p.title!, `${p.body ?? ''}${COPY.ticketFooter}`.trim());
    case 'comment_ticket':
      return tracker.comment(key, p.body!);
    case 'close_ticket':
      return tracker.close(key);
    case 'reopen_ticket':
      return tracker.reopen(key);
    case 'assign_ticket':
      return tracker.assign(key, p.assignees!);
    case 'label_ticket':
      return tracker.addLabels(key, p.labels!);
  }
}

// missingDetail has already checked every field used here.
function runGithub(github: GithubService, action: GithubAction, p: IntentParams): Promise<GithubResult> {
  const n = p.issueNumber!;
  switch (action) {
    case 'create_github_issue':
      return github.createIssue(p.title!, p.body);
    case 'create_pull_request':
      return github.openPullRequest(p.title!, p.body ?? '', p.branch);
    case 'comment_github':
      return github.commentOnIssue(n, p.body!);
    case 'label_github_issue':
      return github.addLabels(n, p.labels!);
    case 'assign_github_issue':
      return github.assignIssue(n, p.assignees!);
    case 'request_github_review':
      return github.requestReviewers(n, p.reviewers!);
    case 'close_github_issue':
      return github.closeIssue(n);
    case 'reopen_github_issue':
      return github.reopenIssue(n);
    case 'close_pull_request':
      return github.closePullRequest(n);
    case 'merge_pull_request':
      return github.mergePullRequest(n);
  }
}
