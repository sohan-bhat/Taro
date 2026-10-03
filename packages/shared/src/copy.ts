// Every sentence Taro posts in Slack, says in the meeting chat, or writes into GitHub, plus the
// API messages the dashboard shows. The landing page renders its Slack and GitHub mocks from these
// same functions, so the site shows exactly what the product posts. Done work is past tense;
// questions, refusals, and instructions are present tense; Taro speaks in the first person.

import { GITHUB_CAPABILITIES, type GithubAction } from './constants';
import type { ActionOutcome } from './types';

/** Adds a period when a spoken command has no end punctuation. */
export function sentence(s: string): string {
  const t = s.trim();
  return !t || /[.!?…]["'”’)\]]*$/.test(t) ? t : `${t}.`;
}

/** A Slack mrkdwn link: <url|text>. */
export const slackLink = (url: string, text: string) => `<${url}|${text}>`;

// "a", "a and b", "a, b, and c"
function andList(items: readonly string[]): string {
  return items.length < 3 ? items.join(' and ') : `${items.slice(0, -1).join(', ')}, and ${items[items.length - 1]}`;
}

const handles = (logins: readonly string[]) => andList(logins.map((l) => `@${l.replace(/^@/, '')}`));

// "Couldn't reach MeetingBaas. It timed out." The detail is left off when there isn't one.
const withDetail = (lead: string, detail?: string) => (detail?.trim() ? `${lead} ${sentence(detail)}` : lead);

// Done work on GitHub. `ref` is a Slack link in posts ("<url|#12>") and plain "#12" elsewhere.
const GITHUB_DONE: Record<GithubAction, (ref: string, names: readonly string[]) => string> = {
  create_github_issue: (ref) => `Opened issue ${ref}`,
  comment_github: (ref) => `Commented on ${ref}`,
  create_pull_request: (ref) => `Opened pull request ${ref}`,
  label_github_issue: (ref, labels) => (labels.length ? `Added ${andList(labels)} to ${ref}` : `Added labels to ${ref}`),
  assign_github_issue: (ref, logins) => (logins.length ? `Assigned ${handles(logins)} to ${ref}` : `Assigned ${ref}`),
  request_github_review: (ref, logins) =>
    logins.length ? `Requested a review from ${handles(logins)} on ${ref}` : `Requested a review on ${ref}`,
  close_github_issue: (ref) => `Closed issue ${ref}`,
  reopen_github_issue: (ref) => `Reopened issue ${ref}`,
  close_pull_request: (ref) => `Closed pull request ${ref}`,
  merge_pull_request: (ref) => `Merged pull request ${ref}`,
};

// What Taro tried, for "Couldn't close issue #12."
const GITHUB_TRIED: Record<GithubAction, (n?: number) => string> = {
  create_github_issue: () => 'open the issue',
  comment_github: (n) => (n ? `comment on #${n}` : 'add the comment'),
  create_pull_request: () => 'open the pull request',
  label_github_issue: (n) => (n ? `add labels to #${n}` : 'add the labels'),
  assign_github_issue: (n) => (n ? `assign #${n}` : 'assign it'),
  request_github_review: (n) => (n ? `request a review on #${n}` : 'request the review'),
  close_github_issue: (n) => (n ? `close issue #${n}` : 'close the issue'),
  reopen_github_issue: (n) => (n ? `reopen issue #${n}` : 'reopen the issue'),
  close_pull_request: (n) => (n ? `close pull request #${n}` : 'close the pull request'),
  merge_pull_request: (n) => (n ? `merge pull request #${n}` : 'merge the pull request'),
};

export const COPY = {
  // Slack thread replies
  slackJoinReply: (platform: string) =>
    `Joining the ${platform} call now. Once I'm in, say *“Hey Taro”* followed by a request and I'll do it right away. You may need to admit me from the lobby.`,
  slackAlreadyIn: `I'm already in this meeting, or on my way in.`,
  slackCouldntJoin: (reason: string) => withDetail(`I couldn't join this meeting.`, reason),
  slackFinishSetup: (url: string) => `Finish setup at ${url}`,
  slackSomethingWrong: `I couldn't join this meeting because something went wrong on my end.`,

  // Meeting chat (MeetingBaas entry_message)
  meetingChatGreeting: (botName: string) => `I'm ${botName}. Say “Hey Taro” and what you need, and I'll do it.`,

  // End of the call
  recap: (lines: readonly string[]) =>
    lines.length ? `Meeting ended. Here's what I did:\n${lines.join('\n')}` : `Meeting ended. Nobody asked me for anything this time.`,
  recapLine: (outcome: ActionOutcome, command: string, summary: string) =>
    outcome === 'done' ? summary : `Not done: “${sentence(command)}” ${summary}`,
  couldntStay: (why: string) => withDetail(`I couldn't stay in this meeting.`, why),

  // Live problems posted to the thread
  noTranscription: `I joined, but this workspace has no transcription set up, so I can't hear requests. Add it in Setup.`,
  transcriptionKeyRejected: (provider: string) =>
    `${provider} rejected the transcription key, so I can't hear this meeting. Update it in Setup.`,

  // Slack checklist message
  checklist: (title: string | undefined, items: readonly string[]) =>
    `*${title || 'Checklist'}*\n${items.map((i) => `☐ ${i}`).join('\n')}`,

  // GitHub
  issueFooter: `\n\n---\n_Filed by Taro during a meeting._`,
  pullBodyFooter: `\n\n_Opened by Taro during a meeting._`,
  proposalFile: (title: string, body: string) =>
    `# ${title}\n\n${body || 'Taro opened this from a meeting request.'}\n\n_Opened by Taro during a meeting._\n`,
  tasksFile: (title: string, checklist: string) => `# Tasks: ${title}\n\n${checklist}\n\n_Tracked by Taro during a meeting._\n`,
  defaultTasks: ['Make the change', 'Add or update tests', 'Review and verify'],
  commitProposal: (title: string) => `docs: propose ${title}`,
  commitTasks: (title: string) => `chore: track tasks for ${title}`,

  // Done: one past tense sentence per request
  posted: (channel: string) => `Posted in #${channel}.`,
  postedChecklist: (tasks: number, channel: string) =>
    `Posted a checklist with ${tasks} ${tasks === 1 ? 'task' : 'tasks'} in #${channel}.`,
  // names: labels to add, or the GitHub logins to assign or ask for a review
  githubDone: (action: GithubAction, ref: string, repo: string, names: readonly string[] = []) =>
    `${GITHUB_DONE[action](ref, names)} in ${repo}.`,

  // Turned off for the workspace
  turnedOff: (action: string) =>
    `${GITHUB_CAPABILITIES.find((c) => c.action === action)?.gerund ?? 'That'} is turned off for this workspace.`,

  // Needs you: a question back
  askPost: `Which channel should I post in, and what should it say? Try “tell engineering the deploy is done.”`,
  askChecklist: `Which channel, and what goes on the list? Try “make a todo list in projects for the docs and QA.”`,
  askNumber: `Which issue or pull request? Say its number, like “close issue nine.”`,
  askIssueTitle: `What should the issue be about? Say it again with a few more words.`,
  askComment: `What should the comment say?`,
  askLabels: `Which labels should I add?`,
  askAssignees: `Who should I assign? Say their GitHub username.`,
  askPullTitle: `What should the pull request do? Say it again with a few more words.`,
  askReviewers: `Who should review it? Say their GitHub username.`,
  heardUnclear: (command: string) => `I heard “${sentence(command)}” but couldn't tell what to do.`,
  noModel: `No AI model is set up for this workspace yet. Add one in Setup.`,
  modelUnreachable: (detail?: string) => withDetail(`I couldn't reach your AI model.`, detail),

  // Failed
  slackNotConnected: `Slack isn't connected for this workspace.`,
  channelNotFound: (channel: string) => `Couldn't post in #${channel}. Slack says there's no channel with that name.`,
  slackFailed: (channel: string, error?: string) =>
    withDetail(`Couldn't post in #${channel}.`, error?.trim() && `Slack says: ${error.trim()}`),
  githubNotConnected: `GitHub isn't connected. An owner or admin can connect it in Setup.`,
  noRepository: `No repository is selected. Choose one in Setup.`,
  githubCouldnt: (action: GithubAction, n?: number) => `Couldn't ${GITHUB_TRIED[action](n)}.`,
  githubFailed: (action: GithubAction, n: number | undefined, error?: string) =>
    withDetail(`Couldn't ${GITHUB_TRIED[action](n)}.`, error?.trim() && `GitHub says: ${error.trim()}`),
  // Appended to a GitHub error: the first for a 403 or 404, the second when a merge gets a 405.
  githubPermissionHint: `Check that the Taro app is still installed on this repository with the right permission.`,
  mergeHint: `The pull request may have conflicts or failing checks.`,
  unexpected: (command: string) => `Something went wrong while doing “${sentence(command)}”`,

  // API messages the dashboard shows
  notReady: (missing: readonly string[]) => `Taro isn't set up yet. Add ${andList(missing)} in Setup.`,
  meetingBaasKeyRejected: `MeetingBaas rejected the API key. Update it in Setup.`,
  meetingBaasNoCredit: `Your MeetingBaas account is out of credit.`,
  meetingBaasRateLimited: `MeetingBaas is rate limiting this key. Try again in a moment.`,
  meetingBaasUnreachable: (detail?: string) => withDetail(`Couldn't reach MeetingBaas.`, detail),
} as const;

/**
 * Server-side cleanup of model-written text: no em or en dashes, and no hyphen used as a dash.
 * Line breaks, markdown bullets, and compound words (sign-in, re-run) are left alone.
 */
export function cleanDashes(s: string): string {
  return s
    .replace(/([^\s|][ \t]+)-+(?=[ \t]+[^\s|])/g, '$1\u2014') // a spaced hyphen is a dash too, outside table cells
    .replace(/(\d[a-z%]{0,3})[ \t]*[\u2012-\u2015\u2E3A\u2E3B\uFE58]+[ \t]*(?=[$\u20AC\u00A3]?\d)/gi, '$1 to ') // a range reads "10 to 20"
    .replace(/[ \t]*(?:[\u2012-\u2015\u2E3A\u2E3B\uFE58][ \t]*)+/g, (dash: string, at: number, all: string) => {
      const before = all[at - 1] ?? '\n';
      const after = all[at + dash.length] ?? '\n';
      // Dropped at a line edge, inside brackets, or next to punctuation or a table pipe; a comma everywhere else.
      if (/[\r\n([{]/.test(before) || /[\r\n.,;:!?)\]}]/.test(after)) return '';
      return /[.,;:!?|]/.test(before) || after === '|' ? ' ' : ', ';
    })
    .replace(/(\S)[ \t]{2,}(?=\S)/g, '$1 ')
    .trim();
}
