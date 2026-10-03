import { test } from 'node:test';
import assert from 'node:assert/strict';
import { COPY, GITHUB_CAPABILITIES } from '@taro/shared';
import {
  cleanParams,
  githubDone,
  githubFailed,
  inferOutcome,
  missingDetail,
  quoted,
  recapLine,
  recapLines,
  slackFailed,
  turnedOff,
} from './outcomes';

const ISSUE_URL = 'https://github.com/acme/web/issues/142';
// The pattern the dashboard reads refs and links out of older results with (Appendix B)
const RESULT = /(#\d+) in ([^:]+): (https?:\/\/\S+)/;

function assertPlain(text: string) {
  assert.doesNotMatch(text, /[–—]/, `${text} has an em or en dash`);
  assert.doesNotMatch(text, /[ \t]-+[ \t]/, `${text} uses a hyphen as a dash`);
  assert.doesNotMatch(text, /\p{Emoji_Presentation}|️/u, `${text} has an emoji`);
}

test('a done GitHub request links the number for Slack and keeps a result the dashboard can read', () => {
  const issue = githubDone('create_github_issue', { url: ISSUE_URL, number: 142 }, 'acme/web', {});
  assert.deepEqual(issue, {
    status: 'success',
    outcome: 'done',
    summary: `Opened issue <${ISSUE_URL}|#142> in acme/web.`,
    result: `Opened issue #142 in acme/web: ${ISSUE_URL}`,
  });

  const pull = githubDone(
    'create_pull_request',
    { url: 'https://github.com/acme/web/pull/57', number: 57, branch: 'taro/cache-the-availability-query' },
    'acme/web',
    {}
  );
  assert.equal(pull.summary, 'Opened pull request <https://github.com/acme/web/pull/57|#57> in acme/web.');
  assert.equal(pull.branch, 'taro/cache-the-availability-query');

  for (const { action } of GITHUB_CAPABILITIES) {
    const done = githubDone(action, { url: ISSUE_URL, number: 142 }, 'acme/web', { labels: ['bug'], assignees: ['priya'], reviewers: ['sam'] });
    assert.match(done.result ?? '', RESULT, action);
    assert.match(done.summary, /\.$/, action);
    assertPlain(done.summary);
  }
});

test('GitHub summaries name what was added, assigned, or asked for', () => {
  const ref = { url: ISSUE_URL, number: 142 };
  assert.equal(
    githubDone('label_github_issue', ref, 'acme/web', { labels: ['bug', 'urgent'] }).summary,
    `Added bug and urgent to <${ISSUE_URL}|#142> in acme/web.`
  );
  assert.equal(
    githubDone('assign_github_issue', ref, 'acme/web', { assignees: ['priya'] }).summary,
    `Assigned @priya to <${ISSUE_URL}|#142> in acme/web.`
  );
  assert.equal(
    githubDone('request_github_review', ref, 'acme/web', { reviewers: ['ana', 'sam'] }).result,
    `Requested a review from @ana and @sam on #142 in acme/web: ${ISSUE_URL}`
  );
});

test('failures lead with what failed, and only quote GitHub when GitHub answered', () => {
  const hint = COPY.githubPermissionHint;
  const answered = githubFailed('close_github_issue', 12, { status: 404, error: `Not Found (HTTP 404). ${hint}` });
  assert.equal(answered.summary, `Couldn't close issue #12. GitHub says: Not Found (HTTP 404). ${hint}`);
  assert.equal(answered.errorMessage, `Not Found (HTTP 404). ${hint}`);
  assert.equal(answered.outcome, 'failed');

  assert.equal(
    githubFailed('create_pull_request', undefined, { error: "Couldn't reach GitHub." }).summary,
    "Couldn't open the pull request. Couldn't reach GitHub."
  );
  assert.equal(githubFailed('merge_pull_request', 21, { status: 405 }).summary, "Couldn't merge pull request #21.");

  const missing = slackFailed('marketing', { notFound: true, error: 'Channel "marketing" not found.' });
  assert.equal(missing.summary, "Couldn't post in #marketing. Slack says there's no channel with that name.");
  // The dashboard recognizes this stored wording
  assert.equal(missing.errorMessage, 'Channel "marketing" not found.');
  assert.equal(
    slackFailed('general', { slackError: 'not_in_channel', error: 'not_in_channel' }).summary,
    "Couldn't post in #general. Slack says: not_in_channel."
  );
});

test('a refusal names the capability that is off', () => {
  assert.deepEqual(turnedOff('merge_pull_request'), {
    status: 'clarification_needed',
    outcome: 'turned_off',
    summary: 'Merging is turned off for this workspace.',
  });
});

test('every missing detail gets its own question, and complete requests get none', () => {
  assert.equal(missingDetail('post_message', { channel: 'general' }), COPY.askPost);
  assert.equal(missingDetail('create_todo_list', { channel: 'launch', items: [] }), COPY.askChecklist);
  assert.equal(missingDetail('create_github_issue', {}), COPY.askIssueTitle);
  assert.equal(missingDetail('create_pull_request', { body: 'x' }), COPY.askPullTitle);
  assert.equal(missingDetail('close_github_issue', {}), COPY.askNumber);
  assert.equal(missingDetail('comment_github', { body: 'Looks good.' }), COPY.askNumber);
  assert.equal(missingDetail('comment_github', { issueNumber: 4 }), COPY.askComment);
  assert.equal(missingDetail('label_github_issue', { issueNumber: 4 }), COPY.askLabels);
  assert.equal(missingDetail('assign_github_issue', { issueNumber: 4 }), COPY.askAssignees);
  assert.equal(missingDetail('request_github_review', { issueNumber: 4, reviewers: [] }), COPY.askReviewers);

  assert.equal(missingDetail('post_message', { channel: 'general', message: 'Hi.' }), null);
  assert.equal(missingDetail('merge_pull_request', { issueNumber: 21 }), null);
  assert.equal(missingDetail('unknown', {}), null);
});

test('model-written fields lose their dashes before anything is posted or stored', () => {
  const clean = cleanParams({
    channel: 'general-chat',
    message: 'Deploy is done — QA signed off',
    title: 'Takes 10–20 seconds',
    items: ['Docs — first', '—', 'QA'],
    labels: ['needs-triage'],
    reason: '—',
    issueNumber: 7,
  });
  assert.deepEqual(clean, {
    channel: 'general-chat',
    message: 'Deploy is done, QA signed off',
    title: 'Takes 10 to 20 seconds',
    items: ['Docs, first', 'QA'],
    labels: ['needs-triage'],
    issueNumber: 7,
  });
});

test('quoted commands are cut at a word and never carry a dash', () => {
  assert.equal(quoted('  close issue twelve  '), 'close issue twelve');
  assert.equal(quoted('close issue 12 - no wait 13'), 'close issue 12, no wait 13');
  const long = quoted(`file an issue about ${'the export timing out '.repeat(10)}`, 60);
  assert.ok(long.length <= 61, long);
  assert.match(long, /[a-z]…$/);
});

test('recap lines: done is the summary, anything else quotes the request first', () => {
  assert.equal(recapLine('done', 'tell general hi', 'Posted in #general.'), 'Posted in #general.');
  assert.equal(
    recapLine('turned_off', 'merge pull request fifty seven', COPY.turnedOff('merge_pull_request')),
    'Not done: “merge pull request fifty seven.” Merging is turned off for this workspace.'
  );
  assertPlain(recapLine('needs_you', 'post it - in general', COPY.askPost));
});

test('recaps of older logs fall back to what they recorded', () => {
  const lines = recapLines([
    { command: 'close issue twelve', status: 'success', outcome: 'done', summary: `Closed issue <${ISSUE_URL}|#142> in acme/web.` },
    { command: 'file an issue about exports', status: 'success', result: `Opened issue #142 in acme/web: ${ISSUE_URL}` },
    { command: 'merge pull request three', status: 'failed', errorMessage: 'Merge conflict' },
    { command: 'do the thing', status: 'clarification_needed', outcome: 'needs_you', summary: COPY.heardUnclear('do the thing') },
  ]);
  assert.deepEqual(lines, [
    `Closed issue <${ISSUE_URL}|#142> in acme/web.`,
    `Opened issue <${ISSUE_URL}|#142> in acme/web.`,
    'Not done: “merge pull request three.” Merge conflict.',
    'Not done: “do the thing.” I heard “do the thing.” but couldn\'t tell what to do.',
  ]);
});

test('outcomes of older logs are inferred the way the dashboard infers them', () => {
  assert.equal(inferOutcome('success'), 'done');
  assert.equal(inferOutcome('failed', 'post_message'), 'failed');
  assert.equal(inferOutcome('clarification_needed', 'merge_pull_request', ['create_github_issue']), 'turned_off');
  assert.equal(inferOutcome('clarification_needed', 'merge_pull_request'), 'needs_you');
  assert.equal(inferOutcome('clarification_needed', 'unknown', ['create_github_issue']), 'needs_you');
});
