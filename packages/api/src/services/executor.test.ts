import { test, type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { COPY } from '@taro/shared';
import { ActionLogModel } from '../db/models';
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
  } = {}
) {
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
  return { posts, saved };
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
