// Every word on the landing page. Whatever Taro itself says (its answers, and everything it posts
// in the Slack and GitHub mocks) is built with COPY from @taro/shared, so the page shows exactly
// what the product posts.

import { COPY, DEFAULT_GITHUB_ACTIONS, GITHUB_CAPABILITIES, slackLink, type GithubAction } from '@taro/shared';
import type { ShotId } from './scene/script';

// One line of the meeting. In the #how scene people's lines are live captions, word by word.
export type StepLine =
  // Narration, in the done face
  | { kind: 'event'; text: string }
  // Said in the call, leading up to a request
  | { kind: 'context'; who: string; said: string }
  // A request, with the heard mark
  | { kind: 'request'; who: string; said: string }
  | { kind: 'taro'; text: string };

export type SlackLine = { who: string; time: string; text: string; taro?: boolean } | { divider: string };

export type StepResult =
  | { kind: 'slack'; channel: string; thread?: boolean; caption: string; messages: SlackLine[] }
  // A picture of one row of the dashboard's GitHub permissions, as a new workspace has it
  | { kind: 'setting'; caption: string; title: string; label: string; description: string; state: string }
  // "[words]{Priya}" in the body marks a phrase Taro took from what Priya said
  | { kind: 'issue'; caption: string; repo: string; number: number; title: string; body: string }
  | {
      kind: 'pull';
      caption: string;
      repo: string;
      number: number;
      title: string;
      base: string;
      head: string;
      commits: number;
      // GitHub markdown, as the model writes it plus the footer Taro appends
      body: string;
    };

export interface Step {
  // How the #how scene finds a step's lines and results
  id: 'join' | 'issue' | 'post' | 'pull' | 'merge' | 'recap';
  time: string;
  // The same wall clock time, machine readable
  dateTime: string;
  lines: StepLine[];
  caption: string;
  result?: StepResult;
}

const REPO = 'acme/web';
const ISSUE_URL = 'https://github.com/acme/web/issues/142';
const PULL_URL = 'https://github.com/acme/web/pull/57';

// Taro's answers in the meeting, word for word what the product says.
const OPENED_ISSUE = COPY.githubDone('create_github_issue', '#142', REPO);
const OPENED_PULL = COPY.githubDone('create_pull_request', '#57', REPO);
const POSTED = COPY.posted('engineering');
const MERGE_ASKED = 'merge pull request fifty seven';
const MERGE_OFF = COPY.turnedOff('merge_pull_request');
const MERGE = GITHUB_CAPABILITIES.find((c) => c.action === 'merge_pull_request')!;

// The labels most product sites use: short nouns for sections, a quiet sign-in link, one button.
export const NAV = {
  sections: [
    { label: 'Product', href: '#how' },
    { label: 'Features', href: '#say' },
    { label: 'Pricing', href: '#keys' },
    { label: 'FAQ', href: '#faq' },
  ],
  demo: 'Demo',
  signIn: 'Sign in',
  start: 'Get started',
  dashboard: 'Dashboard',
};

export const HERO = {
  // The problem, then the answer
  title: ['Meeting follow-ups get lost.', 'Taro does them before you hang up.'],
  context: { who: 'Priya', said: 'The export keeps timing out for our biggest customers.' },
  asker: 'Sam',
  request: 'Hey Taro, file an issue about that.',
  answer: OPENED_ISSUE,
  ding: 'Hear the ding',
  lede: 'Say “Hey Taro” in any Google Meet, Zoom, or Teams call, and it does the work in Slack and GitHub while you keep talking.',
  demo: 'See the demo',
};

export const HOW = {
  title: 'One meeting, start to finish.',
  // The accessible version of the story, and what shows without scripts or with reduced motion
  steps: [
    {
      id: 'join',
      time: '1:58 PM',
      dateTime: '13:58',
      lines: [{ kind: 'event', text: 'Priya posts the meeting link in Slack, and Taro joins.' }],
      caption: 'Or paste the link in your dashboard.',
      result: {
        kind: 'slack',
        channel: 'product',
        thread: true,
        caption: 'The Slack thread where Taro replies',
        messages: [
          { who: 'Priya Raman', time: '1:58 PM', text: 'Sync starting <https://meet.google.com/kdp-wqmx-tvr>' },
          { divider: '1 reply' },
          { who: 'Taro', taro: true, time: '1:58 PM', text: COPY.slackJoinReply('Google Meet') },
        ],
      },
    },
    {
      id: 'issue',
      time: '2:14 PM',
      dateTime: '14:14',
      lines: [
        { kind: 'context', who: HERO.context.who, said: HERO.context.said },
        { kind: 'context', who: 'Dev', said: 'Same on Northwind. It fails after about thirty seconds.' },
        { kind: 'request', who: HERO.asker, said: HERO.request },
        { kind: 'taro', text: OPENED_ISSUE },
      ],
      caption: 'Sam only said “that.” Taro wrote the rest from the conversation before it.',
      result: {
        kind: 'issue',
        caption: 'The GitHub issue Taro opened in acme/web',
        repo: REPO,
        number: 142,
        title: 'Export times out on large accounts',
        body:
          '## Summary\nThe export [times out for our largest customers]{Priya}. It [fails after roughly 30 seconds]{Dev}, so those customers can\'t export their data.\n\n' +
          '## Details\n- Affected: large accounts, [including Northwind]{Dev}\n- Symptom: the export fails after about 30 seconds' +
          COPY.issueFooter,
      },
    },
    {
      id: 'post',
      time: '2:17 PM',
      dateTime: '14:17',
      lines: [
        { kind: 'request', who: 'Sam', said: 'Hey Taro, tell engineering the export fix is going into this sprint.' },
        { kind: 'taro', text: POSTED },
      ],
      caption: "Taro plays a short ding in the call when it's done.",
      result: {
        kind: 'slack',
        channel: 'engineering',
        caption: 'The message Taro posted in #engineering',
        messages: [{ who: 'Taro', taro: true, time: '2:17 PM', text: 'The export timeout fix is going into this sprint.' }],
      },
    },
    {
      id: 'pull',
      time: '2:21 PM',
      dateTime: '14:21',
      lines: [
        { kind: 'context', who: 'Dev', said: 'The reports page is still slow.' },
        { kind: 'request', who: 'Priya', said: 'Hey Taro, open a pull request to speed up the reports page.' },
        { kind: 'taro', text: OPENED_PULL },
      ],
      caption: 'Every pull request starts on its own branch.',
      result: {
        kind: 'pull',
        caption: 'The pull request Taro opened in acme/web',
        repo: REPO,
        number: 57,
        title: 'Speed up the reports page',
        base: 'main',
        head: 'taro/speed-up-the-reports-page',
        // Taro commits a short plan, then a task list
        commits: 2,
        body:
          '## Summary\nThe reports page loads too slowly. This tracks the work to profile it and speed it up before anyone changes the queries.\n\n' +
          '## Changes\n- [ ] Profile the reports page load\n- [ ] Fix the slowest queries or renders\n- [ ] Confirm the page loads faster' +
          COPY.pullBodyFooter,
      },
    },
    {
      id: 'merge',
      time: '2:31 PM',
      dateTime: '14:31',
      lines: [
        { kind: 'request', who: 'Sam', said: `Hey Taro, ${MERGE_ASKED}.` },
        { kind: 'taro', text: MERGE_OFF },
      ],
      caption: 'Taro only does what your workspace allows.',
      result: {
        kind: 'setting',
        caption: 'The workspace setting that keeps merging off',
        title: 'What Taro may do on GitHub',
        label: MERGE.label,
        description: MERGE.description,
        state: (DEFAULT_GITHUB_ACTIONS as readonly string[]).includes(MERGE.action) ? 'On' : 'Off',
      },
    },
    {
      id: 'recap',
      time: '2:34 PM',
      dateTime: '14:34',
      lines: [{ kind: 'event', text: 'The call ends, and Taro posts a recap in the thread.' }],
      caption: 'Anyone who missed the call can catch up.',
      // The same thread, scrolled to its end. The recap lists the requests in the order they were made.
      result: {
        kind: 'slack',
        channel: 'product',
        thread: true,
        caption: 'The end of the Slack thread, with the recap',
        messages: [
          { who: 'Taro', taro: true, time: '2:21 PM', text: COPY.githubDone('create_pull_request', slackLink(PULL_URL, '#57'), REPO) },
          { who: 'Taro', taro: true, time: '2:31 PM', text: MERGE_OFF },
          {
            who: 'Taro',
            taro: true,
            time: '2:34 PM',
            text: COPY.recap([
              COPY.githubDone('create_github_issue', slackLink(ISSUE_URL, '#142'), REPO),
              POSTED,
              COPY.githubDone('create_pull_request', slackLink(PULL_URL, '#57'), REPO),
              COPY.recapLine('turned_off', MERGE_ASKED, MERGE_OFF),
            ]),
          },
        ],
      },
    },
  ] satisfies Step[] as Step[],
  // The scene's own words: the meeting window, what was already in #engineering and the repository,
  // and one short line over the stage from each shot named here until the next.
  scene: {
    meeting: 'Weekly product sync',
    // In the order their tiles sit, before Taro's
    people: ['Priya', 'Dev', 'Sam'],
    ended: 'Meeting ended',
    // 1:58 PM to 2:34 PM
    duration: '36 minutes',
    engineering: [
      { who: 'Ana Torres', time: '1:41 PM', text: 'Staging is on the new build.' },
      { who: 'Dev Iyer', time: '1:44 PM', text: "Thanks. I'll look at the export logs after the sync." },
    ] satisfies SlackLine[],
    issues: [
      { number: 141, title: 'Settings page forgets unsaved changes', opened: 'opened yesterday by sam' },
      { number: 140, title: 'Add keyboard shortcuts to the editor', opened: 'opened 2 days ago by dev' },
      { number: 138, title: 'Invoices show the wrong time zone', opened: 'opened last week by priya' },
    ],
    notes: [
      { from: 'join', text: 'Post the link in Slack. Taro joins.' },
      { from: 'ask-issue', text: 'Say “Hey Taro” and what you need.' },
      { from: 'issue', text: 'It writes the issue from the conversation.' },
      { from: 'ask-post', text: 'Updates land in the right channel.' },
      { from: 'ask-pull', text: 'Every pull request gets its own branch.' },
      { from: 'ask-merge', text: 'It only does what your workspace allows.' },
      { from: 'ended', text: 'A recap when the call ends.' },
    ] satisfies Array<{ from: ShotId; text: string }>,
  },
};

// What each GitHub action makes, for naming the ones a new workspace starts with
const MAKES: Record<GithubAction, string> = {
  create_github_issue: 'issues',
  comment_github: 'comments',
  create_pull_request: 'pull requests',
  label_github_issue: 'labels',
  assign_github_issue: 'assignments',
  request_github_review: 'review requests',
  close_github_issue: 'closed issues',
  reopen_github_issue: 'reopened issues',
  close_pull_request: 'closed pull requests',
  merge_pull_request: 'merges',
};

// "a", "a and b", "a, b, and c"
const andList = (items: readonly string[]) =>
  items.length < 3 ? items.join(' and ') : `${items.slice(0, -1).join(', ')}, and ${items[items.length - 1]}`;

export const SAY = {
  title: "Ask the way you'd ask a teammate.",
  sub: 'Taro reads the last few minutes, so “that” and “it” point at the right thing.',
  groups: [
    { title: 'In Slack', items: ['Post a message', 'Make a checklist'] },
    {
      title: 'On GitHub',
      items: ['File an issue', 'Comment', 'Label', 'Assign', 'Request a review', 'Open a pull request', 'Close or reopen', 'Merge'],
    },
  ],
  note: `Your workspace picks which GitHub actions are on. New workspaces start with ${andList(
    DEFAULT_GITHUB_ACTIONS.map((action) => MAKES[action])
  )}.`,
};

export const KEYS = {
  title: 'Your accounts, your bill, your rules.',
  // Row labels match the dashboard's Setup page
  own: {
    title: 'Bring your own keys',
    rows: [
      { label: 'Meeting bot', value: 'MeetingBaas' },
      { label: 'AI model', value: 'Claude, GPT, Gemini, Groq, OpenRouter, or your own' },
      { label: 'Transcription', value: 'Whisper on Groq or OpenAI' },
    ],
    after: 'You pay each provider directly, and Taro itself is free. Keys are checked, encrypted, and never shown again.',
  },
  lane: {
    title: 'Stays in its lane',
    items: [
      'Acts as its own Slack and GitHub bot, never as you.',
      'Does only the GitHub actions your workspace turns on.',
      'Keeps the text of what it heard, never the audio.',
    ],
  },
};

export const FAQ = {
  title: 'Questions.',
  // The toggle is a word, not an icon
  toggle: { open: 'Answer', close: 'Close' },
  items: [
    {
      q: 'What does Taro cost?',
      a: 'Nothing. Taro itself is free. You pay MeetingBaas and your AI provider directly, at their own prices.',
    },
    {
      q: 'What do I need to get started?',
      a: 'A Google, Microsoft, or Slack account to sign in with, a MeetingBaas API key, and a key for an AI model. A Groq or OpenAI key can cover transcription too. Slack and GitHub are optional.',
    },
    {
      q: 'Which meetings can Taro join?',
      a: "Google Meet, Zoom, and Microsoft Teams. Post the link in any Slack channel Taro is in, or paste it in your dashboard. Taro joins your public channels when it's added to Slack. For a channel created later, type /invite @taro there.",
    },
    {
      q: 'Does Taro record our meetings?',
      a: "Taro keeps the text of what it heard so you can review requests. The audio streams through Taro and isn't saved. Any recording the meeting bot makes stays in your MeetingBaas account, under its retention settings.",
    },
    {
      q: 'Can we run our own copy?',
      a: 'Yes. The API ships with a Dockerfile and the dashboard deploys to Vercel, so a team can host all of it on its own infrastructure.',
    },
  ],
};

export const CLOSING = {
  label: 'Get started',
  said: 'Hey Taro, join our next meeting.',
  answer: "Sign in, and I'll take it from there.",
  demoTitle: 'Look around first.',
  demoBody: 'See a real Taro workspace. No sign-in needed.',
  demo: 'See the demo',
};

export const FOOTER = {
  links: [
    { label: 'Demo', href: '/demo' },
    { label: 'Sign in', href: '/signin' },
    { label: 'Privacy', href: '/privacy' },
    { label: 'Terms', href: '/terms' },
  ],
  // Shown only when NEXT_PUBLIC_REPO_URL is set
  source: 'Source and deploy guide',
  credits: 'Works with Slack, GitHub, Google Meet, Zoom, and Microsoft Teams. Those names and logos belong to their owners.',
};
