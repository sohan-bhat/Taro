/**
 * GitHub connector backed by a GitHub App. Taro authenticates as the app
 * (a JWT signed with the app's private key), exchanges it for a short-lived
 * installation token scoped to the repos the company granted, and acts as
 * `<app>[bot]`. No human credentials are involved at any point.
 */

import crypto from 'crypto';
import { env } from '../config/env';
import { GithubConnectionModel } from '../db/models';

const GITHUB_API = 'https://api.github.com';

// GitHub rejects requests without a User-Agent
const BASE_HEADERS = {
  Accept: 'application/vnd.github+json',
  'X-GitHub-Api-Version': '2022-11-28',
  'User-Agent': 'taro-meeting-assistant',
};

export interface GithubResult {
  success: boolean;
  /** Issue URL on success */
  url?: string;
  /** Issue number on success */
  number?: number;
  error?: string;
}

export function githubAppConfigured(): boolean {
  return !!(env.githubAppId && env.githubAppSlug && env.githubAppPrivateKey);
}

export function githubInstallUrl(companyId: string): string {
  return `https://github.com/apps/${env.githubAppSlug}/installations/new?state=${encodeURIComponent(companyId)}`;
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

async function installationToken(installationId: string): Promise<string> {
  const cached = tokenCache.get(installationId);
  if (cached && cached.expiresAt - Date.now() > 5 * 60 * 1000) return cached.token;

  const response = await fetch(`${GITHUB_API}/app/installations/${installationId}/access_tokens`, {
    method: 'POST',
    headers: { ...BASE_HEADERS, Authorization: `Bearer ${appJwt()}` },
  });
  if (!response.ok) {
    throw new Error(`Could not get an installation token: ${await githubErrorMessage(response)}`);
  }
  const data = (await response.json()) as { token: string; expires_at: string };
  tokenCache.set(installationId, { token: data.token, expiresAt: Date.parse(data.expires_at) });
  return data.token;
}

/** Confirms the installation belongs to this app and returns who installed it */
export async function getInstallation(
  installationId: string
): Promise<{ ok: boolean; accountLogin?: string; error?: string }> {
  const response = await fetch(`${GITHUB_API}/app/installations/${installationId}`, {
    headers: { ...BASE_HEADERS, Authorization: `Bearer ${appJwt()}` },
  });
  if (!response.ok) {
    return { ok: false, error: await githubErrorMessage(response) };
  }
  const data = (await response.json()) as { account?: { login?: string } };
  return { ok: true, accountLogin: data.account?.login };
}

/** Repos the company granted the app access to (first 100) */
export async function listInstallationRepos(installationId: string): Promise<string[]> {
  const token = await installationToken(installationId);
  const response = await fetch(`${GITHUB_API}/installation/repositories?per_page=100`, {
    headers: { ...BASE_HEADERS, Authorization: `Bearer ${token}` },
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
    public enabledActions: string[] = []
  ) {}

  /** Returns null if the company hasn't installed the Taro GitHub App */
  static async fromCompanyId(companyId: string): Promise<GithubService | null> {
    if (!githubAppConfigured()) return null;
    const connection = await GithubConnectionModel.findOne({ companyId });
    if (!connection?.installationId) return null;
    return new GithubService(
      connection.installationId,
      connection.repo ?? '',
      connection.enabledActions ?? []
    );
  }

  private async request(method: string, path: string, body?: unknown): Promise<Response> {
    const token = await installationToken(this.installationId);
    return fetch(`${GITHUB_API}${path}`, {
      method,
      headers: {
        ...BASE_HEADERS,
        Authorization: `Bearer ${token}`,
        ...(body ? { 'Content-Type': 'application/json' } : {}),
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
  }

  private permHint(status: number): string {
    return status === 403 || status === 404
      ? ' (is the Taro app still installed on this repo with the right permission?)'
      : '';
  }

  /** Comment on an issue or pull request (PR conversation = issue comments) */
  async commentOnIssue(issueNumber: number, body: string): Promise<GithubResult> {
    if (!this.repo) return { success: false, error: 'No repository selected. Choose one in the dashboard.' };
    try {
      const response = await this.request('POST', `/repos/${this.repo}/issues/${issueNumber}/comments`, { body });
      if (!response.ok) {
        return { success: false, error: `${await githubErrorMessage(response)}${this.permHint(response.status)}` };
      }
      const data = (await response.json()) as { html_url: string };
      return { success: true, url: data.html_url, number: issueNumber };
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : 'GitHub request failed' };
    }
  }

  /** Set an issue's state open/closed */
  private async setIssueState(issueNumber: number, state: 'open' | 'closed'): Promise<GithubResult> {
    if (!this.repo) return { success: false, error: 'No repository selected. Choose one in the dashboard.' };
    try {
      const response = await this.request('PATCH', `/repos/${this.repo}/issues/${issueNumber}`, { state });
      if (!response.ok) {
        return { success: false, error: `${await githubErrorMessage(response)}${this.permHint(response.status)}` };
      }
      const data = (await response.json()) as { html_url: string; number: number };
      return { success: true, url: data.html_url, number: data.number };
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : 'GitHub request failed' };
    }
  }

  /** Close an issue */
  closeIssue(issueNumber: number): Promise<GithubResult> {
    return this.setIssueState(issueNumber, 'closed');
  }

  /** Reopen a closed issue */
  reopenIssue(issueNumber: number): Promise<GithubResult> {
    return this.setIssueState(issueNumber, 'open');
  }

  /** Add labels to an issue */
  async addLabels(issueNumber: number, labels: string[]): Promise<GithubResult> {
    if (!this.repo) return { success: false, error: 'No repository selected. Choose one in the dashboard.' };
    try {
      const response = await this.request('POST', `/repos/${this.repo}/issues/${issueNumber}/labels`, { labels });
      if (!response.ok) {
        return { success: false, error: `${await githubErrorMessage(response)}${this.permHint(response.status)}` };
      }
      return { success: true, url: `https://github.com/${this.repo}/issues/${issueNumber}`, number: issueNumber };
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : 'GitHub request failed' };
    }
  }

  /** Assign users to an issue */
  async assignIssue(issueNumber: number, assignees: string[]): Promise<GithubResult> {
    if (!this.repo) return { success: false, error: 'No repository selected. Choose one in the dashboard.' };
    try {
      const response = await this.request('POST', `/repos/${this.repo}/issues/${issueNumber}/assignees`, { assignees });
      if (!response.ok) {
        return { success: false, error: `${await githubErrorMessage(response)}${this.permHint(response.status)}` };
      }
      return { success: true, url: `https://github.com/${this.repo}/issues/${issueNumber}`, number: issueNumber };
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : 'GitHub request failed' };
    }
  }

  /** Close a pull request (without merging) */
  async closePullRequest(prNumber: number): Promise<GithubResult> {
    if (!this.repo) return { success: false, error: 'No repository selected. Choose one in the dashboard.' };
    try {
      const response = await this.request('PATCH', `/repos/${this.repo}/pulls/${prNumber}`, { state: 'closed' });
      if (!response.ok) {
        return { success: false, error: `${await githubErrorMessage(response)}${this.permHint(response.status)}` };
      }
      const data = (await response.json()) as { html_url: string; number: number };
      return { success: true, url: data.html_url, number: data.number };
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : 'GitHub request failed' };
    }
  }

  /** Merge a pull request */
  async mergePullRequest(prNumber: number): Promise<GithubResult> {
    if (!this.repo) return { success: false, error: 'No repository selected. Choose one in the dashboard.' };
    try {
      const response = await this.request('PUT', `/repos/${this.repo}/pulls/${prNumber}/merge`, {});
      if (!response.ok) {
        const extra =
          response.status === 405 ? ' (the PR may not be mergeable — conflicts or failing checks)' : this.permHint(response.status);
        return { success: false, error: `${await githubErrorMessage(response)}${extra}` };
      }
      return { success: true, url: `https://github.com/${this.repo}/pull/${prNumber}`, number: prNumber };
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : 'GitHub request failed' };
    }
  }

  /** Request reviewers on a pull request */
  async requestReviewers(prNumber: number, reviewers: string[]): Promise<GithubResult> {
    if (!this.repo) return { success: false, error: 'No repository selected. Choose one in the dashboard.' };
    try {
      const response = await this.request('POST', `/repos/${this.repo}/pulls/${prNumber}/requested_reviewers`, { reviewers });
      if (!response.ok) {
        return { success: false, error: `${await githubErrorMessage(response)}${this.permHint(response.status)}` };
      }
      const data = (await response.json()) as { html_url?: string };
      return { success: true, url: data.html_url ?? `https://github.com/${this.repo}/pull/${prNumber}`, number: prNumber };
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : 'GitHub request failed' };
    }
  }

  /**
   * Open a new branch and a pull request off it. A PR needs the branch to
   * differ from the base, so Taro commits a small proposal file (the request,
   * written up from the meeting) onto the new branch, then opens the PR.
   */
  async openPullRequest(title: string, body: string, branchHint?: string): Promise<GithubResult> {
    if (!this.repo) return { success: false, error: 'No repository selected. Choose one in the dashboard.' };
    try {
      // 1. Default branch + its head SHA (the base)
      const repoRes = await this.request('GET', `/repos/${this.repo}`);
      if (!repoRes.ok) return { success: false, error: await githubErrorMessage(repoRes) };
      const base = ((await repoRes.json()) as { default_branch: string }).default_branch;

      const refRes = await this.request('GET', `/repos/${this.repo}/git/ref/heads/${base}`);
      if (!refRes.ok) return { success: false, error: await githubErrorMessage(refRes) };
      const baseSha = ((await refRes.json()) as { object: { sha: string } }).object.sha;

      // 2. Create the branch (retry with a suffix if the name is taken)
      const slug = (branchHint || title)
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
          return { success: false, error: `${await githubErrorMessage(res)}${this.permHint(res.status)}` };
        }
      }
      if (!made) return { success: false, error: 'Could not create a unique branch name.' };

      // 3. Commit a proposal file so the branch has a diff to open a PR against
      const path = `.taro/proposals/${slug || 'proposal'}.md`;
      const content = `# ${title}\n\n${body || '_(no additional detail)_'}\n\n---\nOpened by Taro from a meeting.\n`;
      const putRes = await this.request('PUT', `/repos/${this.repo}/contents/${path}`, {
        message: `Taro: ${title}`.slice(0, 72),
        content: Buffer.from(content, 'utf8').toString('base64'),
        branch,
      });
      if (!putRes.ok) {
        return { success: false, error: `${await githubErrorMessage(putRes)}${this.permHint(putRes.status)}` };
      }

      // 4. Open the pull request
      const prRes = await this.request('POST', `/repos/${this.repo}/pulls`, {
        title,
        body: `${body || ''}\n\n_Opened by Taro during a meeting._`.trim(),
        head: branch,
        base,
      });
      if (!prRes.ok) {
        return { success: false, error: `${await githubErrorMessage(prRes)}${this.permHint(prRes.status)}` };
      }
      const pr = (await prRes.json()) as { html_url: string; number: number };
      return { success: true, url: pr.html_url, number: pr.number };
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : 'GitHub request failed' };
    }
  }

  async createIssue(title: string, body?: string): Promise<GithubResult> {
    if (!this.repo) {
      return { success: false, error: 'No repository selected. Choose one in the dashboard.' };
    }
    try {
      const token = await installationToken(this.installationId);
      const response = await fetch(`${GITHUB_API}/repos/${this.repo}/issues`, {
        method: 'POST',
        headers: {
          ...BASE_HEADERS,
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ title, ...(body ? { body } : {}) }),
      });

      if (!response.ok) {
        const detail = await githubErrorMessage(response);
        const hint =
          response.status === 403 || response.status === 404
            ? ' (is the Taro app still installed on this repo with Issues: Read and write?)'
            : '';
        return { success: false, error: `${detail}${hint}` };
      }

      const issue = (await response.json()) as { html_url: string; number: number };
      return { success: true, url: issue.html_url, number: issue.number };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'GitHub request failed',
      };
    }
  }
}
