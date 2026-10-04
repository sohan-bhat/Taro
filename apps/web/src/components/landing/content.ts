// Every word on the landing page. Whatever Taro itself says (its answers, the meeting chat greeting,
// and everything it posts in the Slack and GitHub mocks) is built with COPY from @taro/shared, so the
// page shows exactly what the product posts.

import { COPY, DEFAULT_GITHUB_ACTIONS, GITHUB_CAPABILITIES, isGithubAction, slackLink } from '@taro/shared';

export type ScriptLine =
  | { kind: 'event'; text: string }
  // Context lines are set in Ink 2; requests in Ink, with the heard mark
  | { kind: 'said'; who: string; text: string; context?: boolean }
  | { kind: 'taro'; text: string }
  | { kind: 'note'; text: string };

export type SlackLine = { who: string; time: string; text: string; taro?: boolean } | { divider: string };

export type Artifact =
  | { kind: 'slack'; channel: string; thread?: boolean; caption: string; messages: SlackLine[] }
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

export interface TimelineRow {
  time: string;
  // The same wall clock time, machine readable
  dateTime: string;
  script: ScriptLine[];
  artifact?: Artifact;
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

const startsOn = (action: string) => (DEFAULT_GITHUB_ACTIONS as readonly string[]).includes(action);

export const NAV = {
  sections: [
    { label: 'How a meeting goes', href: '#how' },
    { label: 'What to say', href: '#say' },
    { label: 'Your keys', href: '#keys' },
    { label: 'Security', href: '#security' },
    { label: 'Questions', href: '#faq' },
  ],
  demo: 'Demo',
};

export const HERO = {
  meeting: 'Weekly product sync',
  where: 'Google Meet · 2:14 PM',
  context: [
    { who: 'Priya', said: 'The export keeps timing out for our biggest customers.' },
    { who: 'Dev', said: 'Same on Northwind. It fails after about thirty seconds.' },
  ],
  asker: 'Sam',
  request: 'Hey Taro, file an issue about that.',
  answer: OPENED_ISSUE,
  ding: 'Hear the ding Taro plays in the call',
  lede: 'Taro is a voice assistant for your meetings. It joins your Google Meet, Zoom, and Teams calls, and when someone says “Hey Taro,” it does the work in Slack and GitHub while everyone keeps talking.',
  demo: 'See the demo',
  fine: 'Free to use. You bring the meeting bot and AI keys, and pay those providers directly.',
};

// "[words]{pair}" marks a phrase Taro carried from the conversation into the issue. The pair names
// match the provenance rules in globals.css.
export const PROOF = {
  title: 'It heard the whole conversation, not just the command.',
  sub: 'Sam only said “file an issue about that.” Taro read the minutes before it, so the issue says what broke and for whom.',
  quotes: [
    { label: 'Priya, 2:12 PM', said: 'The export [keeps timing out for our biggest customers]{timeout}.' },
    { label: 'Dev, 2:13 PM', said: 'Same on [Northwind]{northwind}. It [fails after about thirty seconds]{thirty}.' },
    { label: 'Sam, 2:14 PM', said: 'Hey Taro, file an issue about that.', asked: true, note: 'The only thing anyone asked for.' },
  ],
  key: 'Dotted words in the issue came from Priya and Dev. Hover over one, or tap it, to see where it came from.',
  // Who said each marked phrase, read out on the issue side
  pairs: { timeout: 'Priya', thirty: 'Dev', northwind: 'Dev' } as Record<string, string>,
  issue: {
    caption: 'The GitHub issue Taro opened in acme/web',
    repo: REPO,
    number: 142,
    title: 'Export times out on large accounts',
    body:
      '## Summary\nThe export [times out for our largest customers]{timeout}. It [fails after roughly 30 seconds]{thirty}, so those customers can\'t export their data.\n\n' +
      '## Details\n- Affected: large accounts, [including Northwind]{northwind}\n- Symptom: the export fails after about 30 seconds' +
      COPY.issueFooter,
  },
};

export const TIMELINE: { title: string; sub: string; rows: TimelineRow[] } = {
  title: 'One meeting, from the link to the recap.',
  sub: 'Nobody opens Taro during the call. Everything below happens in Slack, GitHub, and the meeting you were already in.',
  rows: [
    {
      time: '1:58 PM',
      dateTime: '13:58',
      script: [
        { kind: 'event', text: 'Priya posts the Meet link in #product.' },
        {
          kind: 'note',
          text: "Taro joins your public channels when it's added to Slack, so a link in any of them works. You can also paste one in your dashboard.",
        },
      ],
      artifact: {
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
      time: '2:00 PM',
      dateTime: '14:00',
      script: [
        { kind: 'event', text: 'Taro asks to join. Priya admits it from the lobby, like any guest.' },
        { kind: 'taro', text: COPY.meetingChatGreeting('Taro') },
        { kind: 'note', text: "Taro's first message in the meeting chat, so everyone knows how to ask." },
      ],
    },
    {
      time: '2:06 PM',
      dateTime: '14:06',
      script: [
        { kind: 'said', who: 'Ana', text: 'QA signed off on the release candidate this morning.', context: true },
        { kind: 'said', who: 'Sam', text: 'Hey Taro, tell engineering the release goes out at four.' },
        { kind: 'taro', text: POSTED },
        { kind: 'note', text: "Taro plays a short ding in the call and answers in the meeting's Slack thread." },
      ],
      artifact: {
        kind: 'slack',
        channel: 'engineering',
        caption: 'The message Taro posted in #engineering',
        messages: [
          {
            who: 'Taro',
            taro: true,
            time: '2:06 PM',
            text: 'The release goes out at 4 PM today. QA signed off on the release candidate this morning.',
          },
        ],
      },
    },
    {
      time: '2:14 PM',
      dateTime: '14:14',
      script: [
        { kind: 'said', who: 'Sam', text: 'Hey Taro, file an issue about that.' },
        { kind: 'taro', text: OPENED_ISSUE },
        { kind: 'note', text: 'The issue shown above.' },
      ],
    },
    {
      time: '2:21 PM',
      dateTime: '14:21',
      script: [
        { kind: 'said', who: 'Dev', text: "The reports page is still slow. I'd profile it before we touch the queries.", context: true },
        { kind: 'said', who: 'Priya', text: 'Hey Taro, open a pull request to speed up the reports page.' },
        { kind: 'taro', text: OPENED_PULL },
      ],
      artifact: {
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
      time: '2:31 PM',
      dateTime: '14:31',
      script: [
        { kind: 'said', who: 'Sam', text: `Hey Taro, ${MERGE_ASKED}.` },
        { kind: 'taro', text: MERGE_OFF },
        {
          kind: 'note',
          text: 'New workspaces start with issues, comments, and pull requests. Anything else waits until an owner turns it on, and Taro says so instead of guessing.',
        },
      ],
    },
    {
      time: '2:34 PM',
      dateTime: '14:34',
      script: [
        { kind: 'event', text: 'The call ends. Taro posts a recap in the thread.' },
        { kind: 'note', text: 'Taro also answered in the thread after each request, so anyone who missed the call can catch up.' },
      ],
      // The same thread, scrolled to its end
      artifact: {
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
              POSTED,
              COPY.githubDone('create_github_issue', slackLink(ISSUE_URL, '#142'), REPO),
              COPY.githubDone('create_pull_request', slackLink(PULL_URL, '#57'), REPO),
              COPY.recapLine('turned_off', MERGE_ASKED, MERGE_OFF),
            ]),
          },
        ],
      },
    },
  ],
};

// Each request names the action it runs, so the GitHub groups follow DEFAULT_GITHUB_ACTIONS.
const SAY_ITEMS: Array<{ action: string; said: string; result: string; note?: string }> = [
  { action: 'post_message', said: 'Hey Taro, tell engineering the deploy is done.', result: 'Posts the message in #engineering.' },
  {
    action: 'create_todo_list',
    said: 'Hey Taro, make a todo list in projects for the launch, the docs, and QA.',
    result: 'Posts a checklist with three tasks in #projects.',
  },
  {
    action: 'create_github_issue',
    said: 'Hey Taro, file an issue about the export timing out.',
    result: 'Opens an issue with a summary and the details people mentioned.',
  },
  {
    action: 'create_pull_request',
    said: 'Hey Taro, open a pull request to fix the reports page.',
    result: 'Makes a new branch, commits a short plan and a task list, and opens the pull request.',
  },
  {
    action: 'comment_github',
    said: "Hey Taro, comment on issue twelve that we'll pick it up next sprint.",
    result: 'Leaves that comment on #12.',
  },
  { action: 'label_github_issue', said: 'Hey Taro, label issue nine as bug and urgent.', result: 'Adds both labels to #9.' },
  {
    action: 'assign_github_issue',
    said: 'Hey Taro, assign issue nine to priya.',
    result: 'Assigns @priya to #9.',
    note: "Say the person's GitHub username.",
  },
  {
    action: 'request_github_review',
    said: 'Hey Taro, ask dev to review pull request fifty seven.',
    result: 'Requests a review from @dev on #57.',
  },
  {
    action: 'close_github_issue',
    said: 'Hey Taro, close issue nine.',
    result: 'Closes #9.',
    note: 'Reopening issues and closing pull requests work the same way.',
  },
  { action: 'merge_pull_request', said: 'Hey Taro, merge pull request fifty seven.', result: 'Merges #57.' },
];

export const SAY = {
  title: 'Ask the way you would ask a teammate.',
  sub: 'There is nothing to memorize. Start with “Hey Taro” and say what you need. Taro reads the last few minutes, so “that” and “it” point at the right thing.',
  groups: [
    { title: 'In Slack', items: SAY_ITEMS.filter((i) => !isGithubAction(i.action)) },
    { title: 'On GitHub, on from the start', items: SAY_ITEMS.filter((i) => isGithubAction(i.action) && startsOn(i.action)) },
    {
      title: 'On GitHub, off until an owner turns it on',
      items: SAY_ITEMS.filter((i) => isGithubAction(i.action) && !startsOn(i.action)),
    },
  ],
};

export const KEYS = {
  title: 'Your accounts, your bill. Taro connects them.',
  sub: 'Every workspace plugs in its own providers and pays them directly. Taro itself is free.',
  // Slot names match the dashboard's Setup page
  slots: [
    {
      label: 'Meeting bot',
      title: 'MeetingBaas',
      body: "Joins your Google Meet, Zoom, and Teams calls as a guest and streams the audio to Taro. It's a meeting bot service, not an AI model.",
      pays: 'You pay MeetingBaas.',
    },
    {
      label: 'AI model',
      title: 'The model you pick',
      body: 'Claude, GPT, Gemini, open models on Groq, anything on OpenRouter, or your own OpenAI-compatible endpoint. It works out what people asked for and writes the result.',
      pays: 'You pay your AI provider.',
    },
    {
      label: 'Transcription',
      title: 'Groq Whisper or OpenAI',
      body: 'Turns speech into text as people talk. If your AI model runs on Groq or OpenAI, the same key covers it.',
      pays: 'You pay Groq or OpenAI.',
    },
  ],
  after: "The work lands in Slack and GitHub, through Taro's own Slack app and GitHub App.",
  factsTitle: 'What happens to a key',
  // `backticks` set a key hint in the code face
  facts: [
    { term: 'Checked', detail: "With the provider, before it's saved." },
    { term: 'Stored', detail: 'Encrypted with AES-256-GCM and locked to your workspace.' },
    { term: 'Shown', detail: 'Never again. You see the first and last four characters, like `gsk_…C3dz`, so you can tell keys apart.' },
    { term: 'Changed by', detail: 'Owners and admins of your workspace.' },
    { term: 'Billed', detail: 'By each provider, to your account. Taro adds nothing.' },
  ],
};

export const SECURITY = {
  title: 'Taro only does what your workspace allows.',
  statements: [
    {
      title: 'Its own GitHub identity',
      body: 'Taro works through its own GitHub App, never your account, and only in repositories the person who connected it can push to.',
    },
    {
      title: 'You pick the GitHub actions',
      body: "Anything that's off is refused, even when someone asks out loud. New workspaces start with issues, comments, and pull requests. Everything else stays off until an owner turns it on.",
    },
    {
      title: 'Pull requests start on a new branch',
      body: 'Taro never commits to your main branch. Every pull request gets its own branch, and nothing merges unless your workspace allows it.',
    },
    {
      title: "Audio isn't saved",
      body: 'Taro keeps the text of what it heard so you can review it. The audio streams through and is never written down.',
    },
    {
      title: 'Your Slack workspace is your Taro workspace',
      body: "Whoever adds Taro to Slack owns it. Owners and admins manage keys and connections. Everyone else can send Taro to a meeting and see what it did. Guests can't sign in.",
    },
  ],
  // A picture of the dashboard's permissions panel for a new workspace
  panel: {
    title: 'What Taro may do on GitHub',
    count: `${DEFAULT_GITHUB_ACTIONS.length} of ${GITHUB_CAPABILITIES.length} on`,
    groups: [
      { label: 'On from the start', on: true, rows: GITHUB_CAPABILITIES.filter((c) => startsOn(c.action)) },
      { label: 'Off until an owner turns it on', on: false, rows: GITHUB_CAPABILITIES.filter((c) => !startsOn(c.action)) },
    ],
    states: { on: 'On', off: 'Off' },
    caption: 'This is the setting in your dashboard. Owners and admins change it on the Setup page.',
  },
};

export const FAQ = {
  title: 'Questions people ask us.',
  // The toggle is a word, not an icon
  toggle: { open: 'Answer', close: 'Close' },
  items: [
    {
      q: 'What does Taro cost?',
      a: 'Nothing. Taro itself is free. You pay MeetingBaas and your AI provider directly, at their own prices.',
    },
    {
      q: 'What do I need to get started?',
      a: 'A Slack workspace where you can add apps, a MeetingBaas API key, and a key for an AI model. A Groq or OpenAI key can cover transcription too.',
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
      q: 'What can Taro do on GitHub?',
      a: 'File issues, comment, label, assign, request reviews, open pull requests, and close or merge them. Your workspace picks which of those are allowed. Anything turned off is refused, even when someone asks for it.',
    },
    {
      q: 'Who can change the settings?',
      a: "Whoever adds Taro to your Slack becomes the owner, and Slack's own owners and admins get the same role in Taro. Owners and admins manage keys and connections. Everyone else in your Slack workspace can sign in, send Taro to meetings, and see what it did. Guests can't sign in.",
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
  answer: "Sign in with Slack, and I'll take it from there.",
  fine: 'Then add Taro to Slack, add a MeetingBaas key, and choose an AI model and transcription.',
  demoTitle: 'Look around first.',
  demoBody: 'Open a real Taro workspace: the meetings it joined, what people asked for, and what it did. No sign-in needed.',
  demo: 'See the demo',
};

export const FOOTER = {
  links: [
    { label: 'Demo', href: '/demo' },
    { label: 'Sign in', href: '/signin' },
  ],
  // Shown only when NEXT_PUBLIC_REPO_URL is set
  source: 'Source and deploy guide',
  credits: 'Works with Slack, GitHub, Google Meet, Zoom, and Microsoft Teams. Those names and logos belong to their owners.',
};
