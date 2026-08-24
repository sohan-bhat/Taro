/**
 * Voice-command execution: parse intent, perform the Slack action, log it.
 * Shared by the realtime pipeline (mid-meeting) and the post-meeting
 * webhook fallback.
 */

import { ActionLogModel } from '../db/models';
import { SlackService } from './slack';
import { GithubService } from './github';
import { parseIntent } from './intent';
import { composeContent } from './composer';
import { INTENTS, DEFAULT_GITHUB_ACTIONS, GITHUB_CAPABILITIES } from '@taro/shared';

const GITHUB_ACTIONS = new Set(GITHUB_CAPABILITIES.map((c) => c.action));
const ACTION_LABEL = Object.fromEntries(GITHUB_CAPABILITIES.map((c) => [c.action, c.label]));

export interface ExecutionResult {
  status: 'success' | 'failed' | 'clarification_needed';
  /** One-line human-readable summary for Slack thread reports */
  summary: string;
}

export async function executeCommand(
  meetingId: string,
  companyId: string,
  command: string,
  mode: 'live' | 'post_meeting',
  meetingContext?: string
): Promise<ExecutionResult> {
  try {
    const intent = await parseIntent(command, meetingContext);
    console.log(`[Executor:${mode}] Parsed intent:`, JSON.stringify(intent));

    // Second pass: turn the raw extraction into publishable content
    // (proper issue markdown, cleaned messages, deduped todo items)
    if (intent.action !== INTENTS.UNKNOWN) {
      intent.params = await composeContent(intent.action, intent.params, command, meetingContext);
    }

    let status: ExecutionResult['status'] = 'failed';
    let result: string | undefined;
    let errorMessage: string | undefined;
    let summary = '';

    switch (intent.action) {
      case INTENTS.POST_MESSAGE: {
        const { channel, message } = intent.params;

        if (!channel || !message) {
          status = 'clarification_needed';
          summary = `❓ Couldn't tell the channel or message from: "${command.slice(0, 80)}"`;
          break;
        }

        const slack = await SlackService.fromCompanyId(companyId);
        if (!slack) {
          status = 'failed';
          errorMessage = 'Slack not connected';
          summary = '❌ Slack is not connected for this workspace.';
          break;
        }

        const slackResult = await slack.postMessage(channel, message);
        if (slackResult.success) {
          status = 'success';
          result = `Posted "${message}" to #${channel}`;
          summary = `✅ Posted your message to #${channel}`;
        } else {
          status = 'failed';
          errorMessage = slackResult.error;
          summary = `❌ Couldn't post to #${channel}: ${slackResult.error}`;
        }
        break;
      }

      case INTENTS.CREATE_TODO_LIST: {
        const { channel, title, items } = intent.params;

        if (!channel || !items || items.length === 0) {
          status = 'clarification_needed';
          summary = `❓ Couldn't tell the channel or list items from: "${command.slice(0, 80)}"`;
          break;
        }

        const slack = await SlackService.fromCompanyId(companyId);
        if (!slack) {
          status = 'failed';
          errorMessage = 'Slack not connected';
          summary = '❌ Slack is not connected for this workspace.';
          break;
        }

        const lines = items.map((item) => `☐ ${item}`).join('\n');
        const text = `📋 *${title || 'Todo List'}*\n${lines}`;

        const slackResult = await slack.postMessage(channel, text);
        if (slackResult.success) {
          status = 'success';
          result = `Created todo list (${items.length} items) in #${channel}`;
          summary = `✅ Created a todo list with ${items.length} item${items.length === 1 ? '' : 's'} in #${channel}`;
        } else {
          status = 'failed';
          errorMessage = slackResult.error;
          summary = `❌ Couldn't create the todo list in #${channel}: ${slackResult.error}`;
        }
        break;
      }

      case INTENTS.CREATE_GITHUB_ISSUE:
      case INTENTS.COMMENT_GITHUB:
      case INTENTS.CLOSE_GITHUB_ISSUE:
      case INTENTS.REOPEN_GITHUB_ISSUE:
      case INTENTS.LABEL_GITHUB_ISSUE:
      case INTENTS.ASSIGN_GITHUB_ISSUE:
      case INTENTS.CLOSE_PULL_REQUEST:
      case INTENTS.MERGE_PULL_REQUEST:
      case INTENTS.REQUEST_GITHUB_REVIEW: {
        const github = await GithubService.fromCompanyId(companyId);
        if (!github) {
          status = 'failed';
          errorMessage = 'GitHub not connected';
          summary = '❌ GitHub is not connected. Install the Taro app in the dashboard first.';
          break;
        }

        // Policy gate: the company must have this action enabled, regardless of
        // what the GitHub App is technically permitted to do.
        const enabled =
          github.enabledActions.length > 0 ? github.enabledActions : DEFAULT_GITHUB_ACTIONS;
        if (!enabled.includes(intent.action)) {
          status = 'clarification_needed';
          summary = `🔒 "${ACTION_LABEL[intent.action]}" is turned off for your workspace. Enable it in the dashboard if you want Taro to do that.`;
          break;
        }

        const p = intent.params;
        const n = p.issueNumber;
        const repo = github.repo;
        // Actions that operate on an existing issue/PR need a number
        const needsNumber =
          intent.action !== INTENTS.CREATE_GITHUB_ISSUE;
        if (needsNumber && !n) {
          status = 'clarification_needed';
          summary = `❓ Couldn't tell which issue/PR number from: "${command.slice(0, 80)}"`;
          break;
        }

        let gh: { success: boolean; url?: string; number?: number; error?: string };
        let verb: string;

        switch (intent.action) {
          case INTENTS.CREATE_GITHUB_ISSUE: {
            if (!p.title) {
              status = 'clarification_needed';
              summary = `❓ Couldn't tell the issue title from: "${command.slice(0, 80)}"`;
              gh = { success: false };
              verb = 'create';
              break;
            }
            const issueBody = `${p.body || ''}\n\n---\n_Filed by Taro during a meeting._`.trim();
            gh = await github.createIssue(p.title, issueBody);
            verb = 'Opened issue';
            break;
          }
          case INTENTS.COMMENT_GITHUB: {
            if (!p.body) {
              status = 'clarification_needed';
              summary = `❓ Couldn't tell the comment text from: "${command.slice(0, 80)}"`;
              gh = { success: false };
              verb = 'comment';
              break;
            }
            gh = await github.commentOnIssue(n!, p.body);
            verb = 'Commented on';
            break;
          }
          case INTENTS.CLOSE_GITHUB_ISSUE:
            gh = await github.closeIssue(n!);
            verb = 'Closed issue';
            break;
          case INTENTS.REOPEN_GITHUB_ISSUE:
            gh = await github.reopenIssue(n!);
            verb = 'Reopened issue';
            break;
          case INTENTS.LABEL_GITHUB_ISSUE:
            if (!p.labels || p.labels.length === 0) {
              status = 'clarification_needed';
              summary = `❓ Couldn't tell which labels to add from: "${command.slice(0, 80)}"`;
              gh = { success: false };
              verb = 'label';
              break;
            }
            gh = await github.addLabels(n!, p.labels);
            verb = `Labeled (${p.labels.join(', ')})`;
            break;
          case INTENTS.ASSIGN_GITHUB_ISSUE:
            if (!p.assignees || p.assignees.length === 0) {
              status = 'clarification_needed';
              summary = `❓ Couldn't tell who to assign from: "${command.slice(0, 80)}"`;
              gh = { success: false };
              verb = 'assign';
              break;
            }
            gh = await github.assignIssue(n!, p.assignees);
            verb = `Assigned (${p.assignees.join(', ')}) to`;
            break;
          case INTENTS.CLOSE_PULL_REQUEST:
            gh = await github.closePullRequest(n!);
            verb = 'Closed PR';
            break;
          case INTENTS.MERGE_PULL_REQUEST:
            gh = await github.mergePullRequest(n!);
            verb = 'Merged PR';
            break;
          case INTENTS.REQUEST_GITHUB_REVIEW:
            if (!p.reviewers || p.reviewers.length === 0) {
              status = 'clarification_needed';
              summary = `❓ Couldn't tell who to request review from in: "${command.slice(0, 80)}"`;
              gh = { success: false };
              verb = 'request review';
              break;
            }
            gh = await github.requestReviewers(n!, p.reviewers);
            verb = `Requested review (${p.reviewers.join(', ')}) on`;
            break;
          default:
            gh = { success: false, error: 'Unsupported action' };
            verb = 'do';
        }

        // A clarification set above (missing param) short-circuits here
        if (status === 'clarification_needed') break;

        if (gh.success) {
          status = 'success';
          const ref = gh.number ? `#${gh.number}` : '';
          result = `${verb} ${ref} in ${repo}: ${gh.url}`;
          summary = `✅ ${verb} <${gh.url}|${ref || repo}> in ${repo}`;
        } else {
          status = 'failed';
          errorMessage = gh.error;
          summary = `❌ Couldn't ${ACTION_LABEL[intent.action].toLowerCase()}: ${gh.error}`;
        }
        break;
      }

      default: {
        status = 'clarification_needed';
        summary = intent.params.reason
          ? `❓ ${intent.params.reason}`
          : `❓ Heard "${command.slice(0, 80)}" but didn't understand what to do.`;
      }
    }

    await ActionLogModel.create({
      meetingId,
      companyId,
      command,
      intent,
      status,
      mode,
      result,
      errorMessage,
    });

    return { status, summary };
  } catch (error) {
    console.error(`[Executor:${mode}] Command execution error:`, error);

    await ActionLogModel.create({
      meetingId,
      companyId,
      command,
      intent: { action: INTENTS.UNKNOWN, confidence: 0, params: {} },
      status: 'failed',
      mode,
      errorMessage: error instanceof Error ? error.message : 'Unknown error',
    });

    return {
      status: 'failed',
      summary: `❌ Something went wrong executing: "${command.slice(0, 80)}"`,
    };
  }
}
