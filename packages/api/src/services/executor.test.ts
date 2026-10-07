import { test, type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { COPY } from '@taro/shared';
import {
  ActionLogModel,
  CompanyModel,
  GithubConnectionModel,
  JiraConnectionModel,
  LinearConnectionModel,
  SlackConnectionModel,
} from '../db/models';
import { encryptSecret } from '../lib/crypto';
import { LinearService } from './trackers/linear';
import type { TicketResult } from './trackers';
import type { ActionLogDoc } from '../db/models/ActionLog';
import { executeCommand } from './executor';
import { GithubService, type GithubResult } from './github';
import { SlackService, type SlackPostResult } from './slack';
import type { LlmConfig } from './llm';

const GROQ: LlmConfig = { provider: 'groq', apiKey: 'gsk_test', model: 'openai/gpt-oss-120b' };

// Fakes the workspace's Slack, GitHub, and saved logs, so a request runs end to end without a network or a database.
function fakeWorkspace(
  t: TestContext,
  opts: {
    slack?: (channel: string, text: string) => SlackPostResult;
    github?: Partial<Record<keyof GithubService, unknown>>;
    unreachable?: boolean;
    saveFails?: boolean;
    // A connected Linear with these teams (the first takes new tickets), and what its calls answer
    linear?: { teams: string[]; enabledActions?: string[]; answer: (call: string, args: unknown[]) => TicketResult };
  } = {}
) {
  const calls: Array<{ call: string; args: unknown[] }> = [];
  // What the executor reads to tell the model what's connected
  t.mock.method(SlackConnectionModel, 'exists', (async () => (opts.slack ? { _id: 's1' } : null)) as never);
  t.mock.method(GithubConnectionModel, 'findOne', (async () => (opts.github ? { repo: 'acme/web' } : null)) as never);
  t.mock.method(JiraConnectionModel, 'findOne', (async () => null) as never);
  t.mock.method(CompanyModel, 'findById', (async () => ({})) as never);
  const linear = opts.linear;
  t.mock.method(LinearConnectionModel, 'findOne', (async () =>
    linear
      ? {
          companyId: 'c1',
          accessTokenEnc: encryptSecret('lin_test', 'linear-access:c1'),
          teams: linear.teams.map((key) => ({ id: `team-${key}`, key, name: key })),
          defaultTeamId: `team-${linear.teams[0]}`,
          enabledActions: linear.enabledActions,
        }
      : null) as never);
  if (linear) {
    for (const call of ['createTicket', 'comment', 'close', 'reopen', 'assign', 'addLabels'] as const) {
      t.mock.method(LinearService.prototype, call, (async (...args: unknown[]) => {
        calls.push({ call, args });
        return linear.answer(call, args);
      }) as never);
    }
  }
  const posts: Array<{ channel: string; text: string }> = [];
  const saved: Array<Partial<ActionLogDoc>> = [];
  const slack = opts.slack;
  t.mock.method(SlackService, 'fromCompanyId', async () => {
    if (opts.unreachable) throw new Error('socket hang up');
    if (!slack) return null;
    const fake = {
      postMessage: async (channel: string, text: string) => {
        posts.push({ channel, text });
        return slack(channel, text);
      },
    };
    return fake as unknown as SlackService;
  });
  t.mock.method(GithubService, 'fromCompanyId', async () =>
    opts.github ? ({ repo: 'acme/web', enabledActions: undefined, ...opts.github } as unknown as GithubService) : null
  );
  t.mock.method(ActionLogModel, 'create', (async (doc: Partial<ActionLogDoc>) => {
    if (opts.saveFails) throw new Error('database is down');
    saved.push(doc);
    return doc;
  }) as never);
  return { posts, saved, calls };
}

// Answers the model's chat completion with whatever intent was last given.
function fakeModel(t: TestContext) {
  let intent: Record<string, unknown> = {};
  t.mock.method(globalThis, 'fetch', async () =>
    new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify(intent) } }] }), { status: 200 })
  );
  return (next: Record<string, unknown>) => {
    intent = next;
  };
}

test('a message is posted as cleaned and the thread hears one past tense sentence', async (t) => {
  const { posts, saved } = fakeWorkspace(t, { slack: () => ({ success: true, channel: 'engineering' }) });
  const result = await executeCommand('m1', 'c1', 'post the build is green - finally to engineering', 'live', undefined, null);

  assert.deepEqual(result, { status: 'success', outcome: 'done', summary: 'Posted in #engineering.' });
  assert.deepEqual(posts, [{ channel: 'engineering', text: 'the build is green, finally' }]);
  assert.equal(saved.length, 1);
  assert.equal(saved[0].outcome, 'done');
  assert.equal(saved[0].summary, 'Posted in #engineering.');
  assert.equal(saved[0].mode, 'live');
  assert.equal(saved[0].intent?.params.message, 'the build is green, finally');
});

test('a checklist is posted from the copy deck', async (t) => {
  const { posts } = fakeWorkspace(t, { slack: () => ({ success: true, channel: 'launch' }) });
  const result = await executeCommand(
    'm1',
    'c1',
    'make a todo list in launch about the store screenshots, the press note and the beta email',
    'live',
    undefined,
    null
  );
  assert.equal(result.summary, 'Posted a checklist with 3 tasks in #launch.');
  assert.equal(posts[0].text, '*Checklist*\n☐ the store screenshots\n☐ the press note\n☐ the beta email');
});

test('Slack problems say what failed', async (t) => {
  const missing = fakeWorkspace(t, { slack: () => ({ success: false, notFound: true, error: 'Channel "marketing" not found.' }) });
  const result = await executeCommand('m1', 'c1', 'post hello to marketing', 'live', undefined, null);
  assert.deepEqual(result, {
    status: 'failed',
    outcome: 'failed',
    summary: "Couldn't post in #marketing. Slack says there's no channel with that name.",
  });
  assert.equal(missing.saved[0].errorMessage, 'Channel "marketing" not found.');
});

test('without Slack, posts and checklists say Slack is off for the workspace instead of failing', async (t) => {
  const { saved } = fakeWorkspace(t);
  const slackOff = { status: 'clarification_needed', outcome: 'turned_off', summary: COPY.slackNotConnected };
  assert.deepEqual(await executeCommand('m1', 'c1', 'post hello to general', 'post_meeting', undefined, null), slackOff);
  const checklist = 'make a todo list in launch about the store screenshots, the press note and the beta email';
  assert.deepEqual(await executeCommand('m1', 'c1', checklist, 'live', undefined, null), slackOff);
  assert.deepEqual(
    saved.map((log) => log.outcome),
    ['turned_off', 'turned_off']
  );
  assert.match(COPY.slackNotConnected, /add Taro to Slack in Setup/);
});

test('a done GitHub request links its number and stores a result the dashboard reads', async (t) => {
  const closed: number[] = [];
  const { saved } = fakeWorkspace(t, {
    github: {
      enabledActions: ['close_github_issue'],
      closeIssue: async (n: number): Promise<GithubResult> => {
        closed.push(n);
        return { success: true, url: `https://github.com/acme/web/issues/${n}`, number: n };
      },
    },
  });
  const result = await executeCommand('m1', 'c1', 'close issue 12', 'live', undefined, null);
  assert.equal(result.summary, 'Closed issue <https://github.com/acme/web/issues/12|#12> in acme/web.');
  assert.deepEqual(closed, [12]);
  assert.equal(saved[0].result, 'Closed issue #12 in acme/web: https://github.com/acme/web/issues/12');
});

test('an action the workspace turned off is refused by name and never runs', async (t) => {
  let merged = false;
  const { saved } = fakeWorkspace(t, {
    github: {
      mergePullRequest: async (): Promise<GithubResult> => {
        merged = true;
        return { success: true, url: 'https://github.com/acme/web/pull/21', number: 21 };
      },
    },
  });
  const result = await executeCommand('m1', 'c1', 'merge pull request 21', 'live', undefined, null);
  assert.deepEqual(result, {
    status: 'clarification_needed',
    outcome: 'turned_off',
    summary: 'Merging is turned off for this workspace.',
  });
  assert.equal(merged, false);
  assert.equal(saved[0].outcome, 'turned_off');
});

test('a GitHub error quotes GitHub after saying what Taro tried', async (t) => {
  const error = `Not Found (HTTP 404). ${COPY.githubPermissionHint}`;
  fakeWorkspace(t, {
    github: {
      enabledActions: ['close_github_issue'],
      closeIssue: async (): Promise<GithubResult> => ({ success: false, status: 404, error }),
    },
  });
  const result = await executeCommand('m1', 'c1', 'close issue 12', 'live', undefined, null);
  assert.equal(result.summary, `Couldn't close issue #12. GitHub says: ${error}`);
});

test('a pull request stores its branch, and what the model wrote is cleaned first', async (t) => {
  fakeModel(t)({
    action: 'create_pull_request',
    confidence: 0.9,
    title: 'Cache the availability query — courts page',
    body: '## Summary\nThe courts page is slow — it queries availability every time.',
  });
  const opened: Array<{ title: string; body: string }> = [];
  const { saved } = fakeWorkspace(t, {
    github: {
      openPullRequest: async (title: string, body: string): Promise<GithubResult> => {
        opened.push({ title, body });
        return { success: true, url: 'https://github.com/acme/web/pull/58', number: 58, branch: 'taro/cache-the-availability-query' };
      },
    },
  });
  const result = await executeCommand('m1', 'c1', 'open a pull request to cache the availability query', 'live', 'context', GROQ);

  assert.equal(result.summary, 'Opened pull request <https://github.com/acme/web/pull/58|#58> in acme/web.');
  assert.deepEqual(opened, [
    { title: 'Cache the availability query, courts page', body: '## Summary\nThe courts page is slow, it queries availability every time.' },
  ]);
  assert.equal(saved[0].branch, 'taro/cache-the-availability-query');
  assert.equal(saved[0].intent?.source, 'groq');
});

test('a request Taro cannot place asks back with the model reason, or says it did not understand', async (t) => {
  fakeWorkspace(t);
  const modelSays = fakeModel(t);
  modelSays({ action: 'unknown', confidence: 0.2, reason: "I can't check the weather — I can post in Slack." });
  const withReason = await executeCommand('m1', 'c1', "what's the weather", 'live', undefined, GROQ);
  assert.deepEqual(withReason, {
    status: 'clarification_needed',
    outcome: 'needs_you',
    summary: "I can't check the weather, I can post in Slack.",
  });

  modelSays({ action: 'unknown', confidence: 0.3, reason: 'I can only work in the one connected repository' });
  const unfinished = await executeCommand('m1', 'c1', 'file it in the other repo', 'live', undefined, GROQ);
  assert.equal(unfinished.summary, 'I can only work in the one connected repository.');

  modelSays({ action: 'unknown', confidence: 0.1 });
  const bare = await executeCommand('m1', 'c1', 'do the thing', 'live', undefined, GROQ);
  assert.equal(bare.summary, 'I heard “do the thing.” but couldn\'t tell what to do.');

  const noModel = await executeCommand('m1', 'c1', 'do the thing we said', 'live', undefined, null);
  assert.equal(noModel.summary, COPY.noModel);
});

test('an unexpected error still ends in a sentence, and a failed save never hides the result', async (t) => {
  t.mock.method(console, 'error', () => {});
  fakeWorkspace(t, { unreachable: true, saveFails: true });
  const result = await executeCommand('m1', 'c1', 'post the build is green to engineering', 'live', undefined, null);
  assert.deepEqual(result, {
    status: 'failed',
    outcome: 'failed',
    summary: 'Something went wrong while doing “post the build is green to engineering.”',
  });
});

test('a ticket is filed in Linear when it is the tracker connected', async (t) => {
  const { calls, saved } = fakeWorkspace(t, {
    linear: { teams: ['ENG', 'DES'], answer: () => ({ success: true, key: 'ENG-88', url: 'https://linear.app/acme/issue/ENG-88' }) },
  });
  const model = fakeModel(t);
  model({ action: 'create_ticket', confidence: 0.9, title: 'Invite emails land in spam', body: '## Summary\nInvites go to spam.' });
  const result = await executeCommand('m1', 'c1', 'file a ticket about invites going to spam', 'live', undefined, GROQ);

  assert.equal(result.outcome, 'done');
  assert.equal(result.summary, 'Filed <https://linear.app/acme/issue/ENG-88|ENG-88> in Linear.');
  assert.equal(calls[0].call, 'createTicket');
  assert.equal(calls[0].args[0], 'Invite emails land in spam');
  assert.match(String(calls[0].args[1]), /Invites go to spam\.\n\n_Filed by Taro during a meeting\._$/);
  assert.equal(saved[0].intent?.params.tracker, 'linear');
  assert.equal(saved[0].result, 'Filed ENG-88 in Linear: https://linear.app/acme/issue/ENG-88');
});

test('a bare ticket number takes the default team, and turned off actions are refused', async (t) => {
  const { calls } = fakeWorkspace(t, {
    linear: {
      teams: ['ENG'],
      enabledActions: ['create_ticket', 'comment_ticket', 'close_ticket'],
      answer: (_call, args) => ({ success: true, key: String(args[0]), url: `https://linear.app/acme/issue/${args[0]}` }),
    },
  });
  const model = fakeModel(t);
  model({ action: 'close_ticket', confidence: 0.9, ticket: '42' });
  const closed = await executeCommand('m1', 'c1', 'close ticket 42', 'live', undefined, GROQ);
  assert.equal(closed.summary, 'Closed <https://linear.app/acme/issue/ENG-42|ENG-42> in Linear.');
  assert.deepEqual(calls[0], { call: 'close', args: ['ENG-42'] });

  model({ action: 'assign_ticket', confidence: 0.9, ticket: 'ENG-42', assignees: ['priya'] });
  const assigned = await executeCommand('m1', 'c1', 'assign eng 42 to priya', 'live', undefined, GROQ);
  assert.deepEqual(assigned, { status: 'clarification_needed', outcome: 'turned_off', summary: 'Assigning tickets is turned off for this workspace.' });
});

test('tracker answers become plain sentences', async (t) => {
  fakeWorkspace(t, {
    linear: {
      teams: ['ENG'],
      enabledActions: ['assign_ticket', 'comment_ticket'],
      answer: (call) =>
        call === 'assign'
          ? { success: false, error: 'No one in Linear matched jordan', missingPeople: ['jordan'] }
          : { success: false, error: 'Entity not found', status: 200, notFound: true },
    },
  });
  const model = fakeModel(t);
  model({ action: 'assign_ticket', confidence: 0.9, ticket: 'ENG-4', assignees: ['jordan'] });
  assert.equal((await executeCommand('m1', 'c1', 'assign eng 4 to jordan', 'live', undefined, GROQ)).summary, "Couldn't find jordan in Linear. Say their name the way it appears there.");
  model({ action: 'comment_ticket', confidence: 0.9, ticket: 'ENG-404', body: 'Shipped.' });
  assert.equal((await executeCommand('m1', 'c1', 'comment on eng 404 shipped', 'live', undefined, GROQ)).summary, "Couldn't find ENG-404 in Linear.");
});

test('tickets fall back to GitHub issues, and issues to tickets, when only one is connected', async (t) => {
  const created: string[] = [];
  const { calls, saved } = fakeWorkspace(t, {
    github: {
      createIssue: async (title: string) => {
        created.push(title);
        return { success: true, url: 'https://github.com/acme/web/issues/5', number: 5 };
      },
    },
  });
  const model = fakeModel(t);
  model({ action: 'create_ticket', confidence: 0.9, title: 'Fix the export' });
  const result = await executeCommand('m1', 'c1', 'file a ticket to fix the export', 'live', undefined, GROQ);
  assert.equal(result.outcome, 'done');
  assert.deepEqual(created, ['Fix the export']);
  assert.equal(saved[0].intent?.action, 'create_github_issue');
  assert.equal(calls.length, 0);
});

test('an issue goes to Linear when GitHub is not connected', async (t) => {
  const { calls, saved } = fakeWorkspace(t, {
    linear: { teams: ['ENG'], answer: () => ({ success: true, key: 'ENG-9', url: 'https://linear.app/acme/issue/ENG-9' }) },
  });
  const model = fakeModel(t);
  model({ action: 'create_github_issue', confidence: 0.9, title: 'Fix the export' });
  const result = await executeCommand('m1', 'c1', 'open an issue to fix the export', 'live', undefined, GROQ);
  assert.equal(result.summary, 'Filed <https://linear.app/acme/issue/ENG-9|ENG-9> in Linear.');
  assert.equal(calls[0].call, 'createTicket');
  assert.equal(saved[0].intent?.action, 'create_ticket');
});

test('asking for a tracker that is not connected says so', async (t) => {
  fakeWorkspace(t, { linear: { teams: ['ENG'], answer: () => ({ success: true, key: 'ENG-1', url: 'u' }) } });
  const model = fakeModel(t);
  model({ action: 'create_ticket', confidence: 0.9, tracker: 'jira', title: 'Rotate the password' });
  const result = await executeCommand('m1', 'c1', 'make a jira ticket to rotate the password', 'live', undefined, GROQ);
  assert.deepEqual(result, { status: 'failed', outcome: 'failed', summary: "Jira isn't connected. An owner or admin can connect it in Setup." });
});

test('no tracker and no GitHub means asking an owner to connect one', async (t) => {
  fakeWorkspace(t);
  const result = await executeCommand('m1', 'c1', 'close ticket ENG 4', 'live', undefined, null);
  assert.equal(result.summary, COPY.noTracker);
});
