/**
 * Jira, through the Taro app for Jira (apps/jira, a Forge app). Jira's OAuth only acts as the person
 * who signed in, so instead a Jira admin installs the app, and its admin page hands out a connection
 * key: the address of the app's web trigger and a secret shared with it. Taro signs each request with
 * that secret, and the app makes the Jira call as itself, so tickets come from the Taro app. The app
 * only passes on the few Jira calls listed in it, and Taro builds every request here.
 */

import crypto from 'crypto';
import { DEFAULT_TICKET_ACTIONS, type TrackerSpace } from '@taro/shared';
import { JiraConnectionModel, type JiraConnectionDoc } from '../../db/models/JiraConnection';
import { decryptSecret, sha256 } from '../../lib/crypto';
import { errorMessage } from '../../lib/logger';
import { markdownToAdf } from './adf';
import { matchPeople, type TicketResult, type Tracker } from './types';

const TIMEOUT_MS = 20_000;
const KEY_PREFIX = 'taro-jira-1.';

export const triggerContext = (companyId: string) => `jira-trigger:${companyId}`;
export const secretContext = (companyId: string) => `jira-secret:${companyId}`;

export interface JiraKey {
  triggerUrl: string;
  secret: string;
}

/** Reads a pasted connection key. Only Atlassian's own web trigger hosts are accepted, so a key can't point Taro anywhere else. */
export function parseConnectionKey(raw: unknown): JiraKey | null {
  if (typeof raw !== 'string') return null;
  const text = raw.trim();
  if (!text.startsWith(KEY_PREFIX)) return null;
  try {
    const data = JSON.parse(Buffer.from(text.slice(KEY_PREFIX.length), 'base64url').toString('utf8')) as { u?: unknown; s?: unknown };
    if (typeof data.u !== 'string' || typeof data.s !== 'string' || data.s.length < 32) return null;
    const url = new URL(data.u);
    const atlassian = /(^|\.)atlassian-dev\.net$|(^|\.)atlassian\.net$/.test(url.hostname);
    if (url.protocol !== 'https:' || !atlassian || url.username || url.password || url.port) return null;
    return { triggerUrl: url.toString(), secret: data.s };
  } catch {
    return null;
  }
}

export const connectionKeyHash = (key: JiraKey) => sha256(`${key.triggerUrl}\n${key.secret}`);

/** The signature the app checks: HMAC-SHA256 over "<timestamp>.<body>". */
export function signJiraRequest(secret: string, timestamp: number, body: string): string {
  return crypto.createHmac('sha256', secret).update(`${timestamp}.${body}`).digest('hex');
}

export class JiraError extends Error {
  constructor(
    message: string,
    readonly status?: number,
    readonly kind: 'auth' | 'not_found' | 'other' = 'other'
  ) {
    super(message);
    this.name = 'JiraError';
  }
}

interface JiraErrorBody {
  errorMessages?: string[];
  errors?: Record<string, string>;
  message?: string;
}

function jiraMessage(body: unknown, status: number): string {
  const b = (body && typeof body === 'object' ? body : {}) as JiraErrorBody;
  const parts = [...(b.errorMessages ?? []), ...Object.values(b.errors ?? {})];
  return parts.join(' ') || b.message || `HTTP ${status}`;
}

/** One Jira REST call through the app. Returns Jira's JSON; throws JiraError with what Jira or the app said. */
export async function callJira<T>(
  key: JiraKey,
  method: 'GET' | 'POST' | 'PUT',
  path: string,
  opts: { query?: Record<string, string>; body?: unknown } = {}
): Promise<T> {
  const payload = JSON.stringify({ v: 1, method, path, query: opts.query ?? {}, body: opts.body ?? null });
  const timestamp = Math.floor(Date.now() / 1000);
  let res: Response;
  try {
    res = await fetch(key.triggerUrl, {
      method: 'POST',
      redirect: 'error',
      headers: {
        'Content-Type': 'application/json',
        'X-Taro-Timestamp': String(timestamp),
        'X-Taro-Signature': signJiraRequest(key.secret, timestamp, payload),
      },
      body: payload,
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch (error) {
    throw new JiraError(`Couldn't reach the Taro app for Jira: ${errorMessage(error)}`);
  }
  const data = (await res.json().catch(() => null)) as { status?: number; body?: unknown; error?: string } | null;
  // The app itself refused: a bad or replaced key, or an app that's gone
  if (res.status === 401 || res.status === 404 || res.status === 410) {
    throw new JiraError(data?.error || 'The Taro app for Jira refused the connection key.', res.status, 'auth');
  }
  if (!res.ok || !data || typeof data.status !== 'number') {
    throw new JiraError(data?.error || `The Taro app for Jira answered with HTTP ${res.status}.`, res.status);
  }
  if (data.status >= 400) {
    throw new JiraError(jiraMessage(data.body, data.status), data.status, data.status === 404 ? 'not_found' : 'other');
  }
  return data.body as T;
}

export interface JiraSite {
  siteUrl: string;
  siteName: string;
  projects: TrackerSpace[];
}

export async function readJiraSite(key: JiraKey): Promise<JiraSite> {
  const [info, projects] = await Promise.all([
    callJira<{ baseUrl: string; serverTitle?: string }>(key, 'GET', '/rest/api/3/serverInfo'),
    callJira<{ values: Array<{ id: string; key: string; name: string }> }>(key, 'GET', '/rest/api/3/project/search', {
      query: { maxResults: '100', orderBy: 'name' },
    }),
  ]);
  const siteUrl = info.baseUrl.replace(/\/$/, '');
  return {
    siteUrl,
    siteName: info.serverTitle && info.serverTitle !== 'Jira' ? info.serverTitle : new URL(siteUrl).hostname.split('.')[0],
    projects: projects.values.map((p) => ({ id: p.id, key: p.key, name: p.name })),
  };
}

interface IssueType {
  id: string;
  name: string;
  subtask?: boolean;
  hierarchyLevel?: number;
}

const TYPE_PREFERENCE = ['task', 'story', 'bug'];

/** Task when the project has it, then Story, then Bug, then any standard type that isn't an epic. */
export function pickIssueType(types: readonly IssueType[]): IssueType | undefined {
  const standard = types.filter((t) => !t.subtask && (t.hierarchyLevel ?? 0) === 0);
  for (const name of TYPE_PREFERENCE) {
    const hit = standard.find((t) => t.name.toLowerCase() === name);
    if (hit) return hit;
  }
  return standard[0];
}

interface Transition {
  id: string;
  name: string;
  to?: { statusCategory?: { key?: string } };
}

export class JiraService implements Tracker {
  readonly id = 'jira' as const;
  readonly name = 'Jira';
  readonly spaces: TrackerSpace[];
  readonly defaultSpaceKey?: string;
  readonly enabledActions: string[];
  readonly needsReconnect?: boolean;
  private readonly key: JiraKey;

  constructor(private readonly conn: JiraConnectionDoc) {
    this.spaces = conn.projects ?? [];
    this.defaultSpaceKey =
      this.spaces.find((p) => p.key === conn.defaultProjectKey)?.key ?? (this.spaces.length === 1 ? this.spaces[0].key : undefined);
    this.enabledActions = conn.enabledActions ? [...conn.enabledActions] : [...DEFAULT_TICKET_ACTIONS];
    this.needsReconnect = conn.needsReconnect;
    this.key = {
      triggerUrl: decryptSecret(conn.triggerUrlEnc, triggerContext(conn.companyId)),
      secret: decryptSecret(conn.secretEnc, secretContext(conn.companyId)),
    };
  }

  static async fromCompanyId(companyId: string): Promise<JiraService | null> {
    const conn = await JiraConnectionModel.findOne({ companyId });
    return conn ? new JiraService(conn) : null;
  }

  private browse = (issueKey: string) => `${this.conn.siteUrl ?? ''}/browse/${issueKey}`;

  private call<T>(method: 'GET' | 'POST' | 'PUT', path: string, opts?: { query?: Record<string, string>; body?: unknown }) {
    return callJira<T>(this.key, method, path, opts);
  }

  private async run(work: () => Promise<TicketResult>): Promise<TicketResult> {
    try {
      return await work();
    } catch (error) {
      if (error instanceof JiraError) {
        if (error.kind === 'auth') await JiraConnectionModel.updateOne({ companyId: this.conn.companyId }, { $set: { needsReconnect: true } });
        return { success: false, error: error.message, status: error.status, notFound: error.kind === 'not_found', reconnect: error.kind === 'auth' };
      }
      return { success: false, error: errorMessage(error) };
    }
  }

  private done = (issueKey: string, names?: string[]): TicketResult => ({
    success: true,
    key: issueKey,
    url: this.browse(issueKey),
    ...(names ? { names } : {}),
  });

  createTicket(title: string, body?: string): Promise<TicketResult> {
    return this.run(async () => {
      const project = this.defaultSpaceKey;
      if (!project) return { success: false, error: 'No project is chosen for new tickets' };
      const meta = await this.call<{ issueTypes?: IssueType[]; values?: IssueType[] }>(
        'GET',
        `/rest/api/3/issue/createmeta/${project}/issuetypes`
      );
      const type = pickIssueType(meta.issueTypes ?? meta.values ?? []);
      if (!type) return { success: false, error: `${project} has no issue type Taro can use` };
      const made = await this.call<{ key: string }>('POST', '/rest/api/3/issue', {
        body: {
          fields: {
            project: { key: project },
            issuetype: { id: type.id },
            summary: title,
            ...(body ? { description: markdownToAdf(body) } : {}),
          },
        },
      });
      return this.done(made.key);
    });
  }

  comment(key: string, body: string): Promise<TicketResult> {
    return this.run(async () => {
      await this.call('POST', `/rest/api/3/issue/${key}/comment`, { body: { body: markdownToAdf(body) } });
      return this.done(key);
    });
  }

  /** Moves the ticket through the first transition into a status of the given category. */
  private moveTo(key: string, categories: readonly string[]): Promise<TicketResult> {
    return this.run(async () => {
      const { transitions } = await this.call<{ transitions: Transition[] }>('GET', `/rest/api/3/issue/${key}/transitions`);
      const pick = categories.map((c) => transitions.find((t) => t.to?.statusCategory?.key === c)).find(Boolean);
      if (!pick) return { success: false, error: `${key} has no transition Taro can use from its current status` };
      await this.call('POST', `/rest/api/3/issue/${key}/transitions`, { body: { transition: { id: pick.id } } });
      return this.done(key);
    });
  }

  close(key: string) {
    return this.moveTo(key, ['done']);
  }

  reopen(key: string) {
    return this.moveTo(key, ['new', 'indeterminate']);
  }

  assign(key: string, people: readonly string[]): Promise<TicketResult> {
    return this.run(async () => {
      // A Jira ticket has one assignee: the first person named
      const name = people[0];
      const users = await this.call<Array<{ accountId: string; displayName: string; emailAddress?: string; accountType?: string }>>(
        'GET',
        '/rest/api/3/user/assignable/search',
        { query: { issueKey: key, query: name, maxResults: '20' } }
      );
      const humans = users.filter((u) => !u.accountType || u.accountType === 'atlassian');
      const { found, missing } = matchPeople([name], humans, (u) => [u.displayName, u.emailAddress?.split('@')[0]]);
      if (!found[0]) return { success: false, error: `No one in Jira matched ${missing.join(', ')}`, missingPeople: missing };
      await this.call('PUT', `/rest/api/3/issue/${key}/assignee`, { body: { accountId: found[0].accountId } });
      return this.done(key, [found[0].displayName]);
    });
  }

  addLabels(key: string, labels: readonly string[]): Promise<TicketResult> {
    return this.run(async () => {
      // Jira labels can't hold spaces
      const names = [...new Set(labels.map((l) => l.trim().replace(/\s+/g, '-')).filter(Boolean))];
      await this.call('PUT', `/rest/api/3/issue/${key}`, { body: { update: { labels: names.map((add) => ({ add })) } } });
      return this.done(key, names);
    });
  }
}
