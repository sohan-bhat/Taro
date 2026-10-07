// Typed client for the Taro API. The workspace comes from the session token,
// so no call takes a workspace ID.

import type {
  ConnectedSession,
  GithubAccountChoice,
  GithubStatus,
  GoogleCalendarJoinMode,
  GoogleCalendarStatus,
  LlmProviderId,
  Meeting,
  MeetingDetail,
  ProviderSettings,
  ServerMeta,
  SignInProvider,
  SttProviderId,
  UpcomingMeeting,
  User,
  WebhookDelivery,
  WebhookEndpoint,
  Workspace,
  WorkspaceOverview,
  WorkspaceRole,
} from '@taro/shared';
import { getToken } from './session';

export const API_URL = (process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000').replace(/\/$/, '');

export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

async function request<T>(path: string, init: { method?: string; body?: unknown } = {}): Promise<T> {
  const token = getToken();
  let res: Response;
  try {
    res = await fetch(`${API_URL}${path}`, {
      method: init.method ?? 'GET',
      headers: {
        'Content-Type': 'application/json',
        // ngrok's free tier serves an HTML warning page instead of JSON without this
        'ngrok-skip-browser-warning': 'true',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: init.body === undefined ? undefined : JSON.stringify(init.body),
    });
  } catch {
    throw new ApiError(0, 'NETWORK', "Can't reach the Taro server. Check your connection and try again.");
  }

  if (res.status === 204) return undefined as T;
  const data = (await res.json().catch(() => ({}))) as { error?: string; code?: string };
  if (!res.ok) {
    throw new ApiError(res.status, data.code || 'ERROR', data.error || `Request failed (${res.status})`);
  }
  return data as T;
}

const origin = () => (typeof window === 'undefined' ? '' : window.location.origin);

export function isSessionError(error: unknown): boolean {
  return error instanceof ApiError && error.status === 401;
}

export const api = {
  meta: () => request<ServerMeta>('/api/meta'),

  auth: {
    // Where "Sign in with Google" or "with Slack" sends the browser
    startUrl: (provider: SignInProvider, nonce: string) =>
      `${API_URL}/api/auth/${provider}/start?${new URLSearchParams({ n: nonce, returnTo: origin() })}`,
    exchange: (code: string) => request<{ token: string }>('/api/auth/exchange', { method: 'POST', body: { code } }),
    session: () => request<{ workspace: Workspace; me: User }>('/api/auth/session'),
    logout: () => request<void>('/api/auth/logout', { method: 'POST' }),
  },

  workspace: {
    overview: () => request<WorkspaceOverview>('/api/workspace'),
    update: (data: { name?: string; botName?: string }) =>
      request<{ workspace: Workspace }>('/api/workspace', { method: 'PATCH', body: data }),
    completeOnboarding: () =>
      request<{ workspace: Workspace }>('/api/workspace/onboarding-complete', { method: 'POST' }),
    members: () => request<{ members: User[] }>('/api/workspace/members'),
    setRole: (userId: string, role: WorkspaceRole) =>
      request<{ member: User }>(`/api/workspace/members/${userId}`, { method: 'PATCH', body: { role } }),
    removeMember: (userId: string) =>
      request<{ member: User }>(`/api/workspace/members/${userId}`, { method: 'DELETE' }),
    restoreMember: (userId: string) =>
      request<{ member: User }>(`/api/workspace/members/${userId}/restore`, { method: 'POST' }),
    remove: () => request<void>('/api/workspace', { method: 'DELETE' }),
  },

  providers: {
    setMeetingBot: (apiKey: string) =>
      request<{ providers: ProviderSettings }>('/api/providers/meeting-bot', { method: 'PUT', body: { apiKey } }),
    setLlm: (data: { provider: LlmProviderId; apiKey?: string; model?: string; baseUrl?: string }) =>
      request<{ providers: ProviderSettings }>('/api/providers/llm', { method: 'PUT', body: data }),
    setStt: (data: { provider: SttProviderId; apiKey?: string; useLlmKey?: boolean }) =>
      request<{ providers: ProviderSettings }>('/api/providers/stt', { method: 'PUT', body: data }),
    remove: (slot: 'meeting-bot' | 'llm' | 'stt') =>
      request<{ providers: ProviderSettings }>(`/api/providers/${slot}`, { method: 'DELETE' }),
  },

  meetings: {
    list: (archived = false) => request<{ meetings: Meeting[] }>(`/api/meetings?archived=${archived ? '1' : '0'}`),
    get: (id: string) => request<{ meeting: MeetingDetail }>(`/api/meetings/${encodeURIComponent(id)}`),
    send: (meetingUrl: string) =>
      request<{ meeting: Meeting; alreadyActive: boolean }>('/api/meetings', { method: 'POST', body: { meetingUrl } }),
    leave: (id: string) =>
      request<{ meeting: Meeting }>(`/api/meetings/${encodeURIComponent(id)}/leave`, { method: 'POST' }),
    clearHistory: () => request<{ archived: number }>('/api/meetings/clear-history', { method: 'POST' }),
  },

  slack: {
    installUrl: () =>
      request<{ url: string }>('/api/slack/install-url', { method: 'POST', body: { returnTo: origin() } }),
    disconnect: () => request<{ connected: boolean }>('/api/slack', { method: 'DELETE' }),
  },

  github: {
    installUrl: (mode: 'install' | 'connect' = 'install') =>
      request<{ url: string }>('/api/github/install-url', { method: 'POST', body: { returnTo: origin(), mode } }),
    connect: (token: string, installationId?: string) =>
      request<{ connected: boolean; choices?: GithubAccountChoice[] }>('/api/github/connect', {
        method: 'POST',
        body: { token, ...(installationId ? { installationId } : {}) },
      }),
    repos: () => request<{ repos: string[] }>('/api/github/repos'),
    setRepo: (repo: string) => request<{ repo: string }>('/api/github/repo', { method: 'POST', body: { repo } }),
    setCapabilities: (actions: string[]) =>
      request<{ enabledActions: string[] }>('/api/github/capabilities', { method: 'POST', body: { actions } }),
    reconnect: () => request<{ connected: boolean }>('/api/github/reconnect', { method: 'POST' }),
    disconnect: () => request<{ connected: boolean }>('/api/github', { method: 'DELETE' }),
  },

  extension: {
    // A limited token for the Google Meet button: it can send Taro, check on it, and make it leave.
    token: (label: string) =>
      request<{ token: string; label: string }>('/api/extension/token', { method: 'POST', body: { label } }),
  },

  sessions: {
    list: () => request<{ sessions: ConnectedSession[] }>('/api/sessions'),
    revoke: (id: string) => request<{ revoked: boolean }>(`/api/sessions/${encodeURIComponent(id)}`, { method: 'DELETE' }),
  },

  // The signed-in person's own Google Calendar, read only. Connecting leaves for Google and comes
  // back to Setup with a grant that only this person's session can redeem.
  googleCalendar: {
    connectUrl: () =>
      request<{ url: string }>('/api/google-calendar/connect-url', { method: 'POST', body: { returnTo: origin() } }),
    connect: (token: string) =>
      request<{ calendar: GoogleCalendarStatus }>('/api/google-calendar/connect', { method: 'POST', body: { token } }),
    update: (changes: { autoJoin?: boolean; joinMode?: GoogleCalendarJoinMode }) =>
      request<{ calendar: GoogleCalendarStatus }>('/api/google-calendar', { method: 'PATCH', body: changes }),
    disconnect: () => request<{ calendar: GoogleCalendarStatus }>('/api/google-calendar', { method: 'DELETE' }),
  },

  // Calendar meetings: the workspace's Taro address, and the meetings Taro will join from invitations
  // and from this person's own Google Calendar. Each action answers with the refreshed list.
  calendar: {
    address: () => request<{ address: string }>('/api/calendar'),
    rotate: () => request<{ address: string }>('/api/calendar/rotate', { method: 'POST' }),
    upcoming: () => request<{ upcoming: UpcomingMeeting[] }>('/api/calendar/upcoming'),
    act: (id: string, action: 'skip' | 'restore' | 'approve' | 'decline') =>
      request<{ upcoming: UpcomingMeeting[] }>(`/api/calendar/upcoming/${encodeURIComponent(id)}/${action}`, { method: 'POST' }),
  },

  // Outgoing webhooks, owners and admins only. A signing secret comes back in full only from create and rotate.
  webhooks: {
    list: () => request<{ endpoints: WebhookEndpoint[] }>('/api/integrations/webhooks'),
    create: (endpoint: { url: string; description?: string; events: string[] }) =>
      request<{ endpoint: WebhookEndpoint; secret: string }>('/api/integrations/webhooks', { method: 'POST', body: endpoint }),
    update: (id: string, changes: { url?: string; description?: string; events?: string[]; enabled?: boolean }) =>
      request<{ endpoint: WebhookEndpoint }>(`/api/integrations/webhooks/${encodeURIComponent(id)}`, { method: 'PATCH', body: changes }),
    remove: (id: string) => request<{ deleted: boolean }>(`/api/integrations/webhooks/${encodeURIComponent(id)}`, { method: 'DELETE' }),
    rotate: (id: string) =>
      request<{ endpoint: WebhookEndpoint; secret: string }>(`/api/integrations/webhooks/${encodeURIComponent(id)}/rotate`, { method: 'POST' }),
    test: (id: string) =>
      request<{ delivery: WebhookDelivery }>(`/api/integrations/webhooks/${encodeURIComponent(id)}/test`, { method: 'POST' }),
    deliveries: (id: string) =>
      request<{ deliveries: WebhookDelivery[] }>(`/api/integrations/webhooks/${encodeURIComponent(id)}/deliveries`),
  },
};

export type { ConnectedSession, GithubStatus, GoogleCalendarStatus, Meeting, MeetingDetail, ProviderSettings, UpcomingMeeting, User, Workspace, WorkspaceOverview };
