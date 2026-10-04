import assert from 'node:assert/strict';
import { test } from 'node:test';
import { GITHUB_CAPABILITIES } from './constants';
import { COPY, cleanDashes, sentence, slackLink } from './copy';
import { LLM_PROVIDERS, MEETING_BOT_PROVIDER, STT_PROVIDERS } from './providers';

type Copy = typeof COPY;
type SampleArgs = { [K in keyof Copy]: Copy[K] extends (...args: infer A) => string ? A : null };

const issue = slackLink('https://github.com/acme/web/issues/142', '#142');

// One sample call per entry. A new entry fails typechecking here until it gets one.
const SAMPLES: SampleArgs = {
  slackJoinReply: ['Google Meet'],
  slackAlreadyIn: null,
  slackCouldntJoin: ["That meeting link doesn't work. Copy it again from the invite."],
  slackFinishSetup: ['https://taro.example.com/dashboard?view=setup'],
  slackSomethingWrong: null,
  meetingChatGreeting: ['Taro'],
  recap: [['Posted in #engineering.', `Opened issue ${issue} in acme/web.`]],
  recapLine: ['turned_off', 'merge pull request fifty seven', 'Merging is turned off for this workspace.'],
  couldntStay: ['The meeting bot stopped unexpectedly.'],
  noTranscription: null,
  transcriptionKeyRejected: ['Groq'],
  checklist: ['Launch', ['Store screenshots', 'Press note', 'Beta email']],
  issueFooter: null,
  pullBodyFooter: null,
  proposalFile: ['Cache the availability query', ''],
  tasksFile: ['Cache the availability query', '- [ ] Make the change'],
  defaultTasks: null,
  commitProposal: ['cache the availability query'],
  commitTasks: ['cache the availability query'],
  posted: ['engineering'],
  postedChecklist: [3, 'projects'],
  githubDone: ['request_github_review', issue, 'acme/web', ['priya', 'sam']],
  turnedOff: ['merge_pull_request'],
  askPost: null,
  askChecklist: null,
  askNumber: null,
  askIssueTitle: null,
  askComment: null,
  askLabels: null,
  askAssignees: null,
  askPullTitle: null,
  askReviewers: null,
  heardUnclear: ['do the thing'],
  noModel: null,
  modelUnreachable: ['Groq is rate limiting this key. Try again in a moment.'],
  slackNotConnected: null,
  channelNotFound: ['meetings'],
  slackFailed: ['general', 'not_in_channel'],
  githubNotConnected: null,
  noRepository: null,
  githubCouldnt: ['merge_pull_request', 57],
  githubFailed: ['close_github_issue', 12, 'Not Found'],
  githubPermissionHint: null,
  mergeHint: null,
  unexpected: ['close issue nine'],
  notReady: [['a MeetingBaas key', 'an AI model', 'transcription']],
  meetingBaasKeyRejected: null,
  meetingBaasNoCredit: null,
  meetingBaasRateLimited: null,
  meetingBaasUnreachable: ['The request timed out.'],
  leaveUnconfirmed: null,
  leaveRefused: ['MeetingBaas rejected the API key. Update it in Setup.'],
  leaveNeedsKey: null,
};

function render(key: keyof Copy): string {
  const entry: unknown = COPY[key];
  if (typeof entry === 'function') return entry(...(SAMPLES[key] as unknown[]));
  return Array.isArray(entry) ? entry.join('\n') : String(entry);
}

function assertPlainCopy(text: string, where: string) {
  assert.doesNotMatch(text, /[\u2013\u2014]/, `${where} has an em or en dash`);
  assert.doesNotMatch(text, /[ \t]-+[ \t]/, `${where} uses a hyphen as a dash`);
  assert.doesNotMatch(text, /\p{Emoji_Presentation}|\uFE0F/u, `${where} has an emoji`);
}

test('no copy output has an em dash, an en dash, a spaced hyphen, or an emoji', () => {
  for (const key of Object.keys(COPY) as Array<keyof Copy>) assertPlainCopy(render(key), `COPY.${key}`);
  for (const c of GITHUB_CAPABILITIES) assertPlainCopy(`${c.label} ${c.description} ${c.gerund}`, c.action);
  for (const p of [...LLM_PROVIDERS, ...STT_PROVIDERS, MEETING_BOT_PROVIDER]) assertPlainCopy(`${p.name} ${p.tagline}`, p.id);
});

test('Not done recap lines quote the command as a sentence', () => {
  assert.equal(
    COPY.recapLine('turned_off', 'merge pull request fifty seven', COPY.turnedOff('merge_pull_request')),
    'Not done: “merge pull request fifty seven.” Merging is turned off for this workspace.'
  );
  assert.equal(
    COPY.recapLine('needs_you', ' can you close it? ', COPY.askNumber),
    'Not done: “can you close it?” Which issue or pull request? Say its number, like “close issue nine.”'
  );
  assert.equal(COPY.recapLine('done', 'file an issue about that', COPY.posted('engineering')), 'Posted in #engineering.');
});

test('the landing recap is exactly what the copy deck produces', () => {
  const pull = slackLink('https://github.com/acme/web/pull/57', '#57');
  assert.equal(
    COPY.recap([
      COPY.recapLine('done', 'tell engineering qa signed off', COPY.posted('engineering')),
      COPY.recapLine('done', 'file an issue about that', COPY.githubDone('create_github_issue', issue, 'acme/web')),
      COPY.recapLine('done', 'open a pull request for it', COPY.githubDone('create_pull_request', pull, 'acme/web')),
      COPY.recapLine('turned_off', 'merge pull request fifty seven', COPY.turnedOff('merge_pull_request')),
    ]),
    "Meeting ended. Here's what I did:\n" +
      'Posted in #engineering.\n' +
      `Opened issue ${issue} in acme/web.\n` +
      `Opened pull request ${pull} in acme/web.\n` +
      'Not done: “merge pull request fifty seven.” Merging is turned off for this workspace.'
  );
  assert.equal(COPY.recap([]), 'Meeting ended. Nobody asked me for anything this time.');
});

test('done summaries are one sentence, with names joined the way people say them', () => {
  assert.equal(issue, '<https://github.com/acme/web/issues/142|#142>');
  assert.equal(COPY.githubDone('label_github_issue', '#12', 'acme/web', ['bug', 'export', 'p1']), 'Added bug, export, and p1 to #12 in acme/web.');
  assert.equal(COPY.githubDone('assign_github_issue', '#12', 'acme/web', ['priya', '@sam']), 'Assigned @priya and @sam to #12 in acme/web.');
  assert.equal(COPY.githubDone('request_github_review', '#57', 'acme/web', ['ana']), 'Requested a review from @ana on #57 in acme/web.');
  assert.equal(COPY.githubDone('merge_pull_request', '#57', 'acme/web'), 'Merged pull request #57 in acme/web.');
  assert.equal(COPY.postedChecklist(1, 'projects'), 'Posted a checklist with 1 task in #projects.');
  assert.equal(COPY.postedChecklist(3, 'projects'), 'Posted a checklist with 3 tasks in #projects.');
  assert.equal(COPY.checklist(undefined, ['Docs', 'QA']), '*Checklist*\n☐ Docs\n☐ QA');
});

test('every GitHub capability can be refused by name', () => {
  for (const c of GITHUB_CAPABILITIES) {
    assert.equal(COPY.turnedOff(c.action), `${c.gerund} is turned off for this workspace.`);
  }
  assert.equal(COPY.turnedOff('merge_pull_request'), 'Merging is turned off for this workspace.');
  assert.equal(COPY.turnedOff('something_new'), 'That is turned off for this workspace.');
});

test('failures lead with what failed and end every sentence', () => {
  assert.equal(COPY.githubFailed('close_github_issue', 12, 'Not Found'), "Couldn't close issue #12. GitHub says: Not Found.");
  assert.equal(COPY.githubFailed('create_github_issue', undefined, ''), "Couldn't open the issue.");
  assert.equal(COPY.githubCouldnt('label_github_issue', 3), "Couldn't add labels to #3.");
  assert.equal(COPY.slackFailed('general', 'not_in_channel'), "Couldn't post in #general. Slack says: not_in_channel.");
  assert.equal(COPY.slackCouldntJoin('The meeting ended before Taro got in.'), "I couldn't join this meeting. The meeting ended before Taro got in.");
  assert.equal(COPY.meetingBaasUnreachable(' '), "Couldn't reach MeetingBaas.");
  assert.equal(COPY.slackFailed('general', undefined), "Couldn't post in #general.");
  assert.equal(
    COPY.notReady(['a MeetingBaas key', 'an AI model', 'transcription']),
    "Taro isn't set up yet. Add a MeetingBaas key, an AI model, and transcription in Setup."
  );
  assert.equal(COPY.notReady(['transcription']), "Taro isn't set up yet. Add transcription in Setup.");
  assert.equal(COPY.unexpected('close issue nine'), 'Something went wrong while doing “close issue nine.”');
});

test('sentence adds a period only when one is missing', () => {
  assert.equal(sentence('close issue nine'), 'close issue nine.');
  assert.equal(sentence('  is it done?  '), 'is it done?');
  assert.equal(sentence('Ship it!'), 'Ship it!');
  assert.equal(sentence('Say “Hey Taro.”'), 'Say “Hey Taro.”');
  assert.equal(sentence('the users’'), 'the users’.');
  assert.equal(sentence(''), '');
});

test('cleanDashes covers every case withoutDashes did', () => {
  assert.equal(cleanDashes('Export fails \u2014 only for large files.'), 'Export fails, only for large files.');
  assert.equal(cleanDashes('Exports\u2014large ones\u2014time out'), 'Exports, large ones, time out');
  assert.equal(cleanDashes('Takes 10\u201320 seconds'), 'Takes 10 to 20 seconds');
  assert.equal(cleanDashes('\u2014 Leading dash'), 'Leading dash');
  assert.equal(cleanDashes('Keep sign-in and re-run hyphens'), 'Keep sign-in and re-run hyphens');
  assert.equal(cleanDashes('Trailing \u2014.'), 'Trailing.');
});

test('cleanDashes turns hyphens used as dashes into commas and ranges into "to"', () => {
  const cases: Array<[string, string]> = [
    ['Export fails - only for large files.', 'Export fails, only for large files.'],
    ['Export fails -- only for large files.', 'Export fails, only for large files.'],
    ['Pages 10 - 20 are blank', 'Pages 10 to 20 are blank'],
    ['Open 9am\u20135pm, $5\u2013$10 a seat', 'Open 9am to 5pm, $5 to $10 a seat'],
    ['Steps 1\u20132\u20133', 'Steps 1 to 2 to 3'],
    ['Two things: \u2014 the export', 'Two things: the export'],
    ['The fix (\u2014 maybe) works', 'The fix (maybe) works'],
    ['Hello \u2014 \u2014 world', 'Hello, world'],
    ['Hello \u2015 world', 'Hello, world'],
    ['x \u2014, y', 'x, y'],
    ['Trailing \u2014', 'Trailing'],
    ['\u2014', ''],
    ['Spaces  inside   text', 'Spaces inside text'],
    ['Released 2026-10-03; run with --force', 'Released 2026-10-03; run with --force'],
  ];
  for (const [input, want] of cases) assert.equal(cleanDashes(input), want, JSON.stringify(input));
});

test('cleanDashes keeps line breaks and markdown in issue bodies', () => {
  assert.equal(cleanDashes('Steps:\n- Open the app\n  - Nested\n\n---\nDone.'), 'Steps:\n- Open the app\n  - Nested\n\n---\nDone.');
  assert.equal(cleanDashes('Steps:\n\u2014 Open the app\n\u2014 Click export'), 'Steps:\nOpen the app\nClick export');
  assert.equal(cleanDashes('Line one \u2014\nLine two'), 'Line one\nLine two');
  assert.equal(cleanDashes('Line one \u2014\r\nLine two'), 'Line one\r\nLine two');
  assert.equal(cleanDashes('Paragraph one.\n\nParagraph two.'), 'Paragraph one.\n\nParagraph two.');
  const table = '| Step | Result |\n| --- | --- |\n| Export | - |';
  assert.equal(cleanDashes(table), table);
  assert.equal(cleanDashes('| Export | \u2014 |'), '| Export | |');
});
