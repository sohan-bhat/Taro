/**
 * GitHub connector backed by a GitHub App. Taro authenticates as the app
 * (a JWT signed with the app's private key), exchanges it for a short-lived
 * installation token scoped to the one repo it is acting on, and acts as
 * `<app>[bot]`. A person's own GitHub authorization is used once, at connect
 * time, to see which repos they can push to; it is never stored.
 */

import crypto from 'crypto';
import { COPY, sentence } from '@taro/shared';
import { env, githubAppConfigured } from '../config/env';
import { GithubConnectionModel } from '../db/models';
import { errorMessage } from '../lib/logger';

const GITHUB_API = 'https://api.github.com';
const TIMEOUT_MS = 15_000;

// GitHub rejects requests without a User-Agent
const BASE_HEADERS = {
  Accept: 'application/vnd.github+json',
  'X-GitHub-Api-Version': '2022-11-28',
  'User-Agent': 'taro-meeting-assistant',
};

export type GithubResult =
  | { success: true; url: string; number: number; branch?: string }
  // `status` is GitHub's HTTP status, present only when GitHub answered
  | { success: false; error: string; status?: number };

type GithubFailure = Extract<GithubResult, { success: false }>;

/** GitHub answered with an error status. */
class GithubHttpError extends Error {
  constructor(
    readonly detail: string,
    readonly status: number,
    context: string
  ) {
    super(`${context}: ${detail}`);
    this.name = 'GithubHttpError';
  }
}

export function githubInstallUrl(state: string): string {
  return `https://github.com/apps/${env.githubAppSlug}/installations/new?state=${encodeURIComponent(state)}`;
}

/** Authorize-only flow, for connecting an installation that already exists. */
export function githubAuthorizeUrl(state: string): string {
  const params = new URLSearchParams({
    client_id: env.githubAppClientId,
    state,
    redirect_uri: `${env.apiUrl}/api/github/callback`,
  });
  return `https://github.com/login/oauth/authorize?${params}`;
}

/**
 * Trades the OAuth code GitHub appends after install (with "Request user
 * authorization during installation" on) for a short-lived user token. Used
 * once, only to check which installations that person can actually access.
 */
export async function exchangeUserCode(code: string): Promise<string> {
  const res = await fetch('https://github.com/login/oauth/access_token', {
    method: 'POST',
    headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
    body: JSON.stringify({
      client_id: env.githubAppClientId,
      client_secret: env.githubAppClientSecret,
      code,
    }),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  const data = (await res.json().catch(() => ({}))) as { access_token?: string; error_description?: string };
  if (!res.ok || !data.access_token) {
    throw new Error(data.error_description || `GitHub OAuth exchange failed (HTTP ${res.status})`);
  }
  return data.access_token;
}

export interface UserInstallation {
  installationId: string;
  accountLogin: string;
}

/** Installations of this app the signed-in GitHub user has access to. */
export async function listUserInstallations(userToken: string): Promise<UserInstallation[]> {
  const out: UserInstallation[] = [];
  for (let page = 1; page <= 5; page++) {
    const res = await fetch(`${GITHUB_API}/user/installations?per_page=100&page=${page}`, {
      headers: { ...BASE_HEADERS, Authorization: `Bearer ${userToken}` },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!res.ok) throw new Error(`Could not list your GitHub installations: ${await githubErrorMessage(res)}`);
    const data = (await res.json()) as { installations?: Array<{ id: number; account?: { login?: string } }> };
    const batch = data.installations ?? [];
    for (const i of batch) out.push({ installationId: String(i.id), accountLogin: i.account?.login ?? 'unknown' });
    if (batch.length < 100) break;
  }
  return out;
}

/**
 * Repos in an installation this person can push to. Read access isn't enough:
 * Taro writes with the app's permissions, so a reader must not be able to
 * connect a repo and then write to it through Taro.
 */
export async function listUserPushableRepos(userToken: string, installationId: string): Promise<string[]> {
  const out: string[] = [];
  for (let page = 1; page <= 10; page++) {
    const res = await fetch(
      `${GITHUB_API}/user/installations/${encodeURIComponent(installationId)}/repositories?per_page=100&page=${page}`,
      { headers: { ...BASE_HEADERS, Authorization: `Bearer ${userToken}` }, signal: AbortSignal.timeout(TIMEOUT_MS) }
    );
    if (!res.ok) throw new Error(`Could not list your repositories: ${await githubErrorMessage(res)}`);
    const data = (await res.json()) as {
      repositories?: Array<{ full_name: string; permissions?: { admin?: boolean; maintain?: boolean; push?: boolean } }>;
    };
    const batch = data.repositories ?? [];
    for (const r of batch) {
      if (r.permissions?.push || r.permissions?.maintain || r.permissions?.admin) out.push(r.full_name);
    }
    if (batch.length < 100) break;
  }
  return out;
}

async function githubErrorMessage(response: Response): Promise<string> {
  try {
    const data = (await response.json()) as { message?: string };
    if (data.message) return `${data.message} (HTTP ${response.status})`;
  } catch {
    // Non-JSON error body
  }
  return `GitHub API returned HTTP ${response.status}`;
}

function base64url(input: Buffer | string): string {
  return Buffer.from(input).toString('base64').replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
}

/**
 * The task list a pull request commits: the write-up's own checklist, else the
 * bullets under a Changes heading, else the copy deck's default plan.
 */
export function checklistFrom(body: string): string {
  const tasks: string[] = [];
  const planned: string[] = [];
  let heading = '';
  for (const line of body.split('\n')) {
    const h = line.match(/^#{1,6}\s+(.*)$/);
    if (h) {
      heading = h[1].toLowerCase();
      continue;
    }
    const task = line.match(/^\s*[-*]\s+\[[ xX]\]\s+(.+)$/);
    if (task) tasks.push(task[1].trim());
    else {
      const bullet = line.match(/^\s*[-*]\s+(.+)$/);
      if (bullet && /change|task|plan|step/.test(heading)) planned.push(bullet[1].trim());
    }
  }
  const items = tasks.length > 0 ? tasks : planned.length > 0 ? planned : [...COPY.defaultTasks];
  return items.map((item) => `- [ ] ${item}`).join('\n');
}

// "Cache the query" reads "cache the query" in a commit subject; "API limits" stays as it is.
const lowerFirst = (s: string) => (/^[A-Z][a-z]/.test(s) ? s[0].toLowerCase() + s.slice(1) : s);

/** Everything a new pull request is made of, from the copy deck. */
export function pullRequestDraft(title: string, body: string) {
  const subject = lowerFirst(title);
  return {
    proposal: COPY.proposalFile(title, body),
    tasks: COPY.tasksFile(title, checklistFrom(body)),
    proposalCommit: COPY.commitProposal(subject),
    tasksCommit: COPY.commitTasks(subject),
    description: `${body}${COPY.pullBodyFooter}`.trim(),
  };
}

// GitHub's own message, then what to check when the app may have lost access.
function withHint(detail: string, status: number, hint?: string): string {
  const extra = status === 403 || status === 404 ? COPY.githubPermissionHint : hint;
  return extra ? `${sentence(detail)} ${extra}` : detail;
}

async function failure(response: Response, hint?: string): Promise<GithubFailure> {
  return { success: false, status: response.status, error: withHint(await githubErrorMessage(response), response.status, hint) };
}

function thrown(error: unknown): GithubFailure {
  if (error instanceof GithubHttpError) {
    return { success: false, status: error.status, error: withHint(error.detail, error.status) };
  }
  if (error instanceof Error && (error.name === 'TimeoutError' || error.name === 'AbortError')) {
    return { success: false, error: "GitHub didn't answer in time." };
  }
  if (error instanceof TypeError && error.message === 'fetch failed') {
    return { success: false, error: "Couldn't reach GitHub." };
  }
  return { success: false, error: errorMessage(error) };
}

/** App-level JWT (RS256), valid for 9 minutes, used to mint installation tokens */
function appJwt(): string {
  const now = Math.floor(Date.now() / 1000);
  const header = base64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const payload = base64url(JSON.stringify({ iat: now - 60, exp: now + 9 * 60, iss: env.githubAppId }));
  const data = `${header}.${payload}`;
  const signature = crypto.sign('RSA-SHA256', Buffer.from(data), env.githubAppPrivateKey);
  return `${data}.${base64url(signature)}`;
}

// Installation tokens live ~1h; cache and refresh a few minutes early
const tokenCache = new Map<string, { token: string; expiresAt: number }>();

/**
 * A token for the installation, narrowed to one repo when `repo` is given, so
 * even a bug elsewhere can't reach the installation's other repos.
 */
async function installationToken(installationId: string, repo?: string): Promise<string> {
  const cacheKey = `${installationId}:${repo ?? '*'}`;
  const cached = tokenCache.get(cacheKey);
  if (cached && cached.expiresAt - Date.now() > 5 * 60 * 1000) return cached.token;

  const repoName = repo?.split('/')[1];
  const response = await fetch(`${GITHUB_API}/app/installations/${encodeURIComponent(installationId)}/access_tokens`, {
    method: 'POST',
    headers: {
      ...BASE_HEADERS,
      Authorization: `Bearer ${appJwt()}`,
      ...(repoName ? { 'Content-Type': 'application/json' } : {}),
    },
    ...(repoName ? { body: JSON.stringify({ repositories: [repoName] }) } : {}),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!response.ok) {
    throw new GithubHttpError(await githubErrorMessage(response), response.status, 'Could not get an installation token');
  }
  const data = (await response.json()) as { token: string; expires_at: string };
  if (tokenCache.size > 1000) tokenCache.clear();
  tokenCache.set(cacheKey, { token: data.token, expiresAt: Date.parse(data.expires_at) });
  return data.token;
}

/** Confirms the installation belongs to this app and returns who installed it */
export async function getInstallation(
  installationId: string
): Promise<{ ok: boolean; accountLogin?: string; error?: string }> {
  const response = await fetch(`${GITHUB_API}/app/installations/${encodeURIComponent(installationId)}`, {
    headers: { ...BASE_HEADERS, Authorization: `Bearer ${appJwt()}` },
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!response.ok) {
    return { ok: false, error: await githubErrorMessage(response) };
  }
  const data = (await response.json()) as { account?: { login?: string } };
  return { ok: true, accountLogin: data.account?.login };
}

/** Repos the installation currently grants the app, with issues turned on (first 100) */
export async function listInstallationRepos(installationId: string): Promise<string[]> {
  const token = await installationToken(installationId);
  const response = await fetch(`${GITHUB_API}/installation/repositories?per_page=100`, {
    headers: { ...BASE_HEADERS, Authorization: `Bearer ${token}` },
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!response.ok) {
    throw new Error(`Could not list repositories: ${await githubErrorMessage(response)}`);
  }
  const data = (await response.json()) as { repositories?: Array<{ full_name: string; has_issues: boolean }> };
  return (data.repositories ?? []).filter((r) => r.has_issues).map((r) => r.full_name);
}

export class GithubService {
  constructor(
    private installationId: string,
    public repo: string,
    public enabledActions: string[] | undefined
  ) {}

  /** Returns null if the company hasn't installed the Taro GitHub App */
  static async fromCompanyId(companyId: string): Promise<GithubService | null> {
    if (!githubAppConfigured()) return null;
    const connection = await GithubConnectionModel.findOne({ companyId });
    // A soft-disconnected workspace keeps its installation for reconnecting, but must not act on it
    if (!connection?.installationId || connection.disconnectedAt) return null;
    const repo = connection.repo && connection.allowedRepos?.includes(connection.repo) ? connection.repo : '';
    return new GithubService(
      connection.installationId,
      repo,
      connection.enabledActions ? [...connection.enabledActions] : undefined
    );
  }

  private async request(method: string, path: string, body?: unknown): Promise<Response> {
    const token = await installationToken(this.installationId, this.repo);
    return fetch(`${GITHUB_API}${path}`, {
      method,
      headers: {
        ...BASE_HEADERS,
        Authorization: `Bearer ${token}`,
        ...(body ? { 'Content-Type': 'application/json' } : {}),
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  }

  /** Comment on an issue or pull request (PR conversation = issue comments) */
  async commentOnIssue(issueNumber: number, body: string): Promise<GithubResult> {
    if (!this.repo) return { success: false, error: COPY.noRepository };
    try {
      const response = await this.request('POST', `/repos/${this.repo}/issues/${issueNumber}/comments`, { body });
      if (!response.ok) return failure(response);
      const data = (await response.json()) as { html_url: string };
      return { success: true, url: data.html_url, number: issueNumber };
    } catch (error) {
      return thrown(error);
    }
  }

  private async setIssueState(issueNumber: number, state: 'open' | 'closed'): Promise<GithubResult> {
    if (!this.repo) return { success: false, error: COPY.noRepository };
    try {
      const response = await this.request('PATCH', `/repos/${this.repo}/issues/${issueNumber}`, { state });
      if (!response.ok) return failure(response);
      const data = (await response.json()) as { html_url: string; number: number };
      return { success: true, url: data.html_url, number: data.number };
    } catch (error) {
      return thrown(error);
    }
  }

  closeIssue(issueNumber: number): Promise<GithubResult> {
    return this.setIssueState(issueNumber, 'closed');
  }

  reopenIssue(issueNumber: number): Promise<GithubResult> {
    return this.setIssueState(issueNumber, 'open');
  }

  async addLabels(issueNumber: number, labels: string[]): Promise<GithubResult> {
    if (!this.repo) return { success: false, error: COPY.noRepository };
    try {
      const response = await this.request('POST', `/repos/${this.repo}/issues/${issueNumber}/labels`, { labels });
      if (!response.ok) return failure(response);
      return { success: true, url: `https://github.com/${this.repo}/issues/${issueNumber}`, number: issueNumber };
    } catch (error) {
      return thrown(error);
    }
  }

  async assignIssue(issueNumber: number, assignees: string[]): Promise<GithubResult> {
    if (!this.repo) return { success: false, error: COPY.noRepository };
    try {
      const response = await this.request('POST', `/repos/${this.repo}/issues/${issueNumber}/assignees`, { assignees });
      if (!response.ok) return failure(response);
      return { success: true, url: `https://github.com/${this.repo}/issues/${issueNumber}`, number: issueNumber };
    } catch (error) {
      return thrown(error);
    }
  }

  async closePullRequest(prNumber: number): Promise<GithubResult> {
    if (!this.repo) return { success: false, error: COPY.noRepository };
    try {
      const response = await this.request('PATCH', `/repos/${this.repo}/pulls/${prNumber}`, { state: 'closed' });
      if (!response.ok) return failure(response);
      const data = (await response.json()) as { html_url: string; number: number };
      return { success: true, url: data.html_url, number: data.number };
    } catch (error) {
      return thrown(error);
    }
  }

  async mergePullRequest(prNumber: number): Promise<GithubResult> {
    if (!this.repo) return { success: false, error: COPY.noRepository };
    try {
      const response = await this.request('PUT', `/repos/${this.repo}/pulls/${prNumber}/merge`, {});
      // 405: GitHub won't merge it as it stands
      if (!response.ok) return failure(response, response.status === 405 ? COPY.mergeHint : undefined);
      return { success: true, url: `https://github.com/${this.repo}/pull/${prNumber}`, number: prNumber };
    } catch (error) {
      return thrown(error);
    }
  }

  async requestReviewers(prNumber: number, reviewers: string[]): Promise<GithubResult> {
    if (!this.repo) return { success: false, error: COPY.noRepository };
    try {
      const response = await this.request('POST', `/repos/${this.repo}/pulls/${prNumber}/requested_reviewers`, { reviewers });
      if (!response.ok) return failure(response);
      const data = (await response.json()) as { html_url?: string };
      return { success: true, url: data.html_url ?? `https://github.com/${this.repo}/pull/${prNumber}`, number: prNumber };
    } catch (error) {
      return thrown(error);
    }
  }

  /** Each call creates one commit. */
  private async commitFile(branch: string, path: string, content: string, message: string): Promise<GithubFailure | null> {
    const res = await this.request('PUT', `/repos/${this.repo}/contents/${path}`, {
      message: message.slice(0, 72),
      content: Buffer.from(content, 'utf8').toString('base64'),
      branch,
    });
    return res.ok ? null : failure(res);
  }

  /**
   * A PR needs the branch to differ from the base, so Taro lays down a couple
   * of small commits on the new branch (a write-up, then a task checklist)
   * so the PR reads like real staged work rather than one blob.
   */
  async openPullRequest(title: string, body: string, branchHint?: string): Promise<GithubResult> {
    if (!this.repo) return { success: false, error: COPY.noRepository };
    try {
      // Default branch and its head SHA (the PR base)
      const repoRes = await this.request('GET', `/repos/${this.repo}`);
      if (!repoRes.ok) return failure(repoRes);
      const base = ((await repoRes.json()) as { default_branch: string }).default_branch;

      const refRes = await this.request('GET', `/repos/${this.repo}/git/ref/heads/${base}`);
      if (!refRes.ok) return failure(refRes);
      const baseSha = ((await refRes.json()) as { object: { sha: string } }).object.sha;

      // Retry with a random suffix if the branch name is already taken
      const slug =
        (branchHint || title)
          .toLowerCase()
          .replace(/[^a-z0-9]+/g, '-')
          .replace(/^-+|-+$/g, '')
          .slice(0, 40) || 'taro';
      let branch = `taro/${slug}`;
      let made = false;
      for (let attempt = 0; attempt < 3 && !made; attempt++) {
        const name = attempt === 0 ? branch : `${branch}-${Math.floor(Math.random() * 9000 + 1000)}`;
        const res = await this.request('POST', `/repos/${this.repo}/git/refs`, {
          ref: `refs/heads/${name}`,
          sha: baseSha,
        });
        if (res.ok) {
          branch = name;
          made = true;
        } else if (res.status !== 422) {
          return failure(res);
        }
      }
      if (!made) return { success: false, error: "Couldn't find a free branch name." };

      const draft = pullRequestDraft(title, body);
      const proposed = await this.commitFile(branch, `.taro/proposals/${slug}.md`, draft.proposal, draft.proposalCommit);
      if (proposed) return proposed;
      const tracked = await this.commitFile(branch, `.taro/tasks/${slug}.md`, draft.tasks, draft.tasksCommit);
      if (tracked) return tracked;

      const prRes = await this.request('POST', `/repos/${this.repo}/pulls`, {
        title,
        body: draft.description,
        head: branch,
        base,
      });
      if (!prRes.ok) return failure(prRes);
      const pr = (await prRes.json()) as { html_url: string; number: number };
      return { success: true, url: pr.html_url, number: pr.number, branch };
    } catch (error) {
      return thrown(error);
    }
  }

  async createIssue(title: string, body?: string): Promise<GithubResult> {
    if (!this.repo) return { success: false, error: COPY.noRepository };
    try {
      const response = await this.request('POST', `/repos/${this.repo}/issues`, {
        title,
        body: `${body ?? ''}${COPY.issueFooter}`.trim(),
      });
      if (!response.ok) return failure(response);
      const issue = (await response.json()) as { html_url: string; number: number };
      return { success: true, url: issue.html_url, number: issue.number };
    } catch (error) {
      return thrown(error);
    }
  }
}
