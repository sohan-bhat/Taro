/**
 * Linear, as the Taro app. The workspace installs Taro with actor=app, so every ticket, comment,
 * and change comes from the app itself. Access tokens last a day; this refreshes them before they
 * run out, and once more when Linear refuses one.
 */

import { DEFAULT_TICKET_ACTIONS, type TrackerSpace } from '@taro/shared';
import { env } from '../../config/env';
import { LinearConnectionModel, type LinearConnectionDoc } from '../../db/models/LinearConnection';
import { decryptSecret, encryptSecret } from '../../lib/crypto';
import { log, errorMessage } from '../../lib/logger';
import { matchPeople, type TicketResult, type Tracker } from './types';

const API = 'https://api.linear.app/graphql';
const TOKEN_URL = 'https://api.linear.app/oauth/token';
const REVOKE_URL = 'https://api.linear.app/oauth/revoke';
const TIMEOUT_MS = 15_000;
// Refresh this long before Linear's expiry, so a request never starts with a token about to lapse
const REFRESH_EARLY_MS = 5 * 60_000;

export const linearScopes = ['read', 'write', 'issues:create', 'comments:create'];
export const linearRedirectUri = () => `${env.apiUrl}/api/linear/callback`;

export const accessContext = (companyId: string) => `linear-access:${companyId}`;
export const refreshContext = (companyId: string) => `linear-refresh:${companyId}`;

export function linearAuthorizeUrl(state: string): string {
  const params = new URLSearchParams({
    client_id: env.linearClientId,
    redirect_uri: linearRedirectUri(),
    response_type: 'code',
    scope: linearScopes.join(','),
    state,
    // Taro acts as its own app user, never as whoever installs it
    actor: 'app',
    prompt: 'consent',
  });
  return `https://linear.app/oauth/authorize?${params}`;
}

export interface LinearTokens {
  accessToken: string;
  refreshToken?: string;
  expiresAt?: Date;
}

/** Linear answered, but not with what was asked for. */
export class LinearError extends Error {
  constructor(
    message: string,
    readonly status?: number,
    readonly kind: 'auth' | 'not_found' | 'other' = 'other'
  ) {
    super(message);
    this.name = 'LinearError';
  }
}

async function tokenRequest(body: Record<string, string>): Promise<LinearTokens> {
  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ ...body, client_id: env.linearClientId, client_secret: env.linearClientSecret }),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  const data = (await res.json().catch(() => ({}))) as {
    access_token?: string;
    refresh_token?: string;
    expires_in?: number;
    error?: string;
    error_description?: string;
  };
  if (!res.ok || !data.access_token) {
    const detail = data.error_description || data.error || `HTTP ${res.status}`;
    throw new LinearError(`Linear refused the token request: ${detail}`, res.status, res.status === 400 || res.status === 401 ? 'auth' : 'other');
  }
  return {
    accessToken: data.access_token,
    refreshToken: data.refresh_token,
    expiresAt: data.expires_in ? new Date(Date.now() + data.expires_in * 1000) : undefined,
  };
}

export const exchangeLinearCode = (code: string) =>
  tokenRequest({ grant_type: 'authorization_code', code, redirect_uri: linearRedirectUri() });

export async function revokeLinearToken(token: string): Promise<void> {
  await fetch(REVOKE_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', Authorization: `Bearer ${token}` },
    body: new URLSearchParams({ token }),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  }).catch((error) => log.warn('[Linear] Revoking the token failed:', errorMessage(error)));
}

interface GqlError {
  message?: string;
  extensions?: { code?: string; type?: string; userPresentableMessage?: string };
}

/** One GraphQL call with a token. Throws LinearError with what Linear said. */
export async function linearQuery<T>(token: string, query: string, variables: Record<string, unknown> = {}): Promise<T> {
  let res: Response;
  try {
    res = await fetch(API, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ query, variables }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch (error) {
    throw new LinearError(`Couldn't reach Linear: ${errorMessage(error)}`);
  }
  const data = (await res.json().catch(() => ({}))) as { data?: T; errors?: GqlError[] };
  const first = data.errors?.[0];
  if (res.status === 401 || /authenticat/i.test(`${first?.extensions?.type ?? ''} ${first?.extensions?.code ?? ''}`)) {
    throw new LinearError('Linear refused Taro’s access.', res.status, 'auth');
  }
  if (first || !res.ok || !data.data) {
    const message = first?.extensions?.userPresentableMessage || first?.message || `HTTP ${res.status}`;
    const notFound = /not found|could not find/i.test(message) || first?.extensions?.code === 'ENTITY_NOT_FOUND';
    throw new LinearError(message, res.status, notFound ? 'not_found' : 'other');
  }
  return data.data;
}

export interface LinearWorkspace {
  organizationId: string;
  organizationName: string;
  urlKey: string;
  teams: TrackerSpace[];
}

export async function readLinearWorkspace(token: string): Promise<LinearWorkspace> {
  const data = await linearQuery<{
    organization: { id: string; name: string; urlKey: string };
    teams: { nodes: Array<{ id: string; key: string; name: string }> };
  }>(token, `query { organization { id name urlKey } teams(first: 100) { nodes { id key name } } }`);
  return {
    organizationId: data.organization.id,
    organizationName: data.organization.name,
    urlKey: data.organization.urlKey,
    teams: data.teams.nodes.map((t) => ({ id: t.id, key: t.key, name: t.name })).sort((a, b) => a.name.localeCompare(b.name)),
  };
}

// One refresh at a time per workspace, so parallel requests share it
const refreshing = new Map<string, Promise<string>>();

interface IssueRef {
  id: string;
  identifier: string;
  url: string;
  team: { id: string; states: { nodes: Array<{ id: string; type: string; position: number }> } };
  labels: { nodes: Array<{ id: string; name: string }> };
}

const ISSUE = `issue(id: $id) { id identifier url team { id states(first: 100) { nodes { id type position } } } labels(first: 100) { nodes { id name } } }`;

export class LinearService implements Tracker {
  readonly id = 'linear' as const;
  readonly name = 'Linear';
  readonly spaces: TrackerSpace[];
  readonly defaultSpaceKey?: string;
  readonly enabledActions: string[];
  readonly needsReconnect?: boolean;

  constructor(private readonly conn: LinearConnectionDoc) {
    this.spaces = conn.teams ?? [];
    this.defaultSpaceKey = this.spaces.find((t) => t.id === conn.defaultTeamId)?.key ?? (this.spaces.length === 1 ? this.spaces[0].key : undefined);
    this.enabledActions = conn.enabledActions ? [...conn.enabledActions] : [...DEFAULT_TICKET_ACTIONS];
    this.needsReconnect = conn.needsReconnect;
  }

  static async fromCompanyId(companyId: string): Promise<LinearService | null> {
    const conn = await LinearConnectionModel.findOne({ companyId });
    return conn ? new LinearService(conn) : null;
  }

  private async refresh(): Promise<string> {
    const companyId = this.conn.companyId;
    const running = refreshing.get(companyId);
    if (running) return running;
    const job = (async () => {
      if (!this.conn.refreshTokenEnc) throw new LinearError('Linear refused Taro’s access.', 401, 'auth');
      try {
        const tokens = await tokenRequest({
          grant_type: 'refresh_token',
          refresh_token: decryptSecret(this.conn.refreshTokenEnc, refreshContext(companyId)),
        });
        const update = {
          accessTokenEnc: encryptSecret(tokens.accessToken, accessContext(companyId)),
          ...(tokens.refreshToken ? { refreshTokenEnc: encryptSecret(tokens.refreshToken, refreshContext(companyId)) } : {}),
          ...(tokens.expiresAt ? { accessExpiresAt: tokens.expiresAt } : {}),
        };
        await LinearConnectionModel.updateOne({ companyId }, { $set: update, $unset: { needsReconnect: '' } });
        Object.assign(this.conn, update);
        return tokens.accessToken;
      } catch (error) {
        if (error instanceof LinearError && error.kind === 'auth') {
          await LinearConnectionModel.updateOne({ companyId }, { $set: { needsReconnect: true } });
          log.warn(`[Linear] Workspace ${companyId} needs to reconnect: ${error.message}`);
        }
        throw error;
      }
    })().finally(() => refreshing.delete(companyId));
    refreshing.set(companyId, job);
    return job;
  }

  private async token(): Promise<string> {
    const expiresAt = this.conn.accessExpiresAt?.getTime();
    if (expiresAt && expiresAt - Date.now() < REFRESH_EARLY_MS && this.conn.refreshTokenEnc) return this.refresh();
    return decryptSecret(this.conn.accessTokenEnc, accessContext(this.conn.companyId));
  }

  /** A query with the current token, refreshed once if Linear refuses it. */
  async query<T>(query: string, variables: Record<string, unknown> = {}): Promise<T> {
    try {
      return await linearQuery<T>(await this.token(), query, variables);
    } catch (error) {
      if (!(error instanceof LinearError && error.kind === 'auth' && this.conn.refreshTokenEnc)) throw error;
      return linearQuery<T>(await this.refresh(), query, variables);
    }
  }

  private async run(work: () => Promise<TicketResult>): Promise<TicketResult> {
    try {
      return await work();
    } catch (error) {
      if (error instanceof LinearError) {
        return {
          success: false,
          error: error.message,
          status: error.status,
          notFound: error.kind === 'not_found',
          reconnect: error.kind === 'auth',
        };
      }
      return { success: false, error: errorMessage(error) };
    }
  }

  private async issue(key: string): Promise<IssueRef> {
    const data = await this.query<{ issue: IssueRef | null }>(`query($id: String!) { ${ISSUE} }`, { id: key });
    if (!data.issue) throw new LinearError(`${key} wasn't found`, 404, 'not_found');
    return data.issue;
  }

  private async update(issue: IssueRef, input: Record<string, unknown>): Promise<TicketResult> {
    const data = await this.query<{ issueUpdate: { success: boolean } }>(
      `mutation($id: String!, $input: IssueUpdateInput!) { issueUpdate(id: $id, input: $input) { success } }`,
      { id: issue.id, input }
    );
    if (!data.issueUpdate.success) return { success: false, error: 'Linear didn’t save the change' };
    return { success: true, key: issue.identifier, url: issue.url };
  }

  createTicket(title: string, body?: string): Promise<TicketResult> {
    return this.run(async () => {
      const team = this.spaces.find((t) => t.key === this.defaultSpaceKey);
      if (!team) return { success: false, error: 'No team is chosen for new tickets' };
      const data = await this.query<{ issueCreate: { success: boolean; issue?: { identifier: string; url: string } } }>(
        `mutation($input: IssueCreateInput!) { issueCreate(input: $input) { success issue { identifier url } } }`,
        { input: { teamId: team.id, title, ...(body ? { description: body } : {}) } }
      );
      const issue = data.issueCreate.issue;
      if (!data.issueCreate.success || !issue) return { success: false, error: 'Linear didn’t create the ticket' };
      return { success: true, key: issue.identifier, url: issue.url };
    });
  }

  comment(key: string, body: string): Promise<TicketResult> {
    return this.run(async () => {
      const issue = await this.issue(key);
      const data = await this.query<{ commentCreate: { success: boolean } }>(
        `mutation($input: CommentCreateInput!) { commentCreate(input: $input) { success } }`,
        { input: { issueId: issue.id, body } }
      );
      if (!data.commentCreate.success) return { success: false, error: 'Linear didn’t add the comment' };
      return { success: true, key: issue.identifier, url: issue.url };
    });
  }

  /** Moves the ticket to its team's first state of the given types, in Linear's own order. */
  private moveTo(key: string, types: readonly string[]): Promise<TicketResult> {
    return this.run(async () => {
      const issue = await this.issue(key);
      const states = issue.team.states.nodes;
      const state = types
        .map((type) => states.filter((s) => s.type === type).sort((a, b) => a.position - b.position)[0])
        .find(Boolean);
      if (!state) return { success: false, error: 'Its team has no state to move it to' };
      return this.update(issue, { stateId: state.id });
    });
  }

  close(key: string) {
    return this.moveTo(key, ['completed']);
  }

  reopen(key: string) {
    return this.moveTo(key, ['unstarted', 'backlog']);
  }

  assign(key: string, people: readonly string[]): Promise<TicketResult> {
    return this.run(async () => {
      const issue = await this.issue(key);
      const data = await this.query<{ users: { nodes: Array<{ id: string; name: string; displayName: string; email: string }> } }>(
        `query { users(first: 250, filter: { active: { eq: true } }) { nodes { id name displayName email } } }`
      );
      // A Linear ticket has one assignee: the first person named
      const { found, missing } = matchPeople(people.slice(0, 1), data.users.nodes, (u) => [u.name, u.displayName, u.email.split('@')[0]]);
      if (!found[0]) return { success: false, error: `No one in Linear matched ${missing.join(', ')}`, missingPeople: missing };
      const result = await this.update(issue, { assigneeId: found[0].id });
      return result.success ? { ...result, names: [found[0].name] } : result;
    });
  }

  addLabels(key: string, labels: readonly string[]): Promise<TicketResult> {
    return this.run(async () => {
      const issue = await this.issue(key);
      const data = await this.query<{ issueLabels: { nodes: Array<{ id: string; name: string; team: { id: string } | null }> } }>(
        `query { issueLabels(first: 250) { nodes { id name team { id } } } }`
      );
      const usable = data.issueLabels.nodes.filter((l) => !l.team || l.team.id === issue.team.id);
      const ids = new Set(issue.labels.nodes.map((l) => l.id));
      const names: string[] = [];
      for (const wanted of labels) {
        const existing = usable.find((l) => l.name.toLowerCase() === wanted.toLowerCase());
        if (existing) {
          ids.add(existing.id);
          names.push(existing.name);
          continue;
        }
        const made = await this.query<{ issueLabelCreate: { success: boolean; issueLabel?: { id: string; name: string } } }>(
          `mutation($input: IssueLabelCreateInput!) { issueLabelCreate(input: $input) { success issueLabel { id name } } }`,
          { input: { name: wanted, teamId: issue.team.id } }
        );
        if (made.issueLabelCreate.issueLabel) {
          ids.add(made.issueLabelCreate.issueLabel.id);
          names.push(made.issueLabelCreate.issueLabel.name);
        }
      }
      const result = await this.update(issue, { labelIds: [...ids] });
      return result.success ? { ...result, names } : result;
    });
  }
}
