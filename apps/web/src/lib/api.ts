// Typed API client for the Taro backend.

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000';

export class ApiError extends Error {
  constructor(
    public statusCode: number,
    public code: string,
    message: string,
    public requestId?: string
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

export interface Company {
  _id: string;
  name: string;
  domain: string;
  licenseKey?: string;
  onboardedAt?: string;
  createdAt: string;
  updatedAt: string;
}

export interface Meeting {
  _id: string;
  companyId: string;
  meetUrl: string;
  status: 'pending' | 'joining' | 'active' | 'ended' | 'error';
  startedByName?: string;
  archivedAt?: string;
  transcript?: string;
  liveTranscript?: string;
  lastAudioAt?: string;
  startedAt?: string;
  endedAt?: string;
  createdAt: string;
  updatedAt: string;
}

export interface ActionLogEntry {
  _id: string;
  command: string;
  intent: {
    action: string;
    confidence: number;
    params?: {
      channel?: string;
      message?: string;
      title?: string;
      items?: string[];
    };
    source?: string;
  };
  status: 'success' | 'failed' | 'clarification_needed';
  result?: string;
  errorMessage?: string;
  createdAt: string;
}

export interface MeetingDetail extends Meeting {
  actionLogs: ActionLogEntry[];
}

export interface SlackStatus {
  connected: boolean;
  teamName?: string;
  connectedAt?: string;
}

export interface GithubStatus {
  connected: boolean;
  /** False when the server has no GitHub App credentials yet */
  configured?: boolean;
  accountLogin?: string;
  repo?: string;
  needsRepo?: boolean;
  enabledActions?: string[];
  /** True when a prior installation exists and can be reconnected in one click */
  reconnectable?: boolean;
  connectedAt?: string;
}

// Attaches the workspace access token when present; after activation the license key is never sent again, only this token.
async function request<T>(
  endpoint: string,
  options: RequestInit = {}
): Promise<T> {
  const url = `${API_URL}${endpoint}`;

  const token =
    typeof window !== 'undefined' ? localStorage.getItem(TOKEN_STORAGE_KEY) : null;

  const response = await fetch(url, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      // Without this, ngrok's free tier serves an HTML interstitial instead of JSON. Harmless elsewhere.
      'ngrok-skip-browser-warning': 'true',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...options.headers,
    },
  });

  if (!response.ok) {
    let errorData: { error?: string; code?: string; requestId?: string } = {};
    try {
      errorData = await response.json();
    } catch {
      // not JSON, fall through with defaults
    }

    throw new ApiError(
      response.status,
      errorData.code || 'UNKNOWN_ERROR',
      errorData.error || `Request failed with status ${response.status}`,
      errorData.requestId
    );
  }

  if (response.status === 204) {
    return undefined as T;
  }

  return response.json();
}

export interface Activation {
  company: Company;
  accessToken: string;
}

export const companies = {
  create: (data: { name: string; domain: string; licenseKey: string }): Promise<Activation> =>
    request('/api/companies', {
      method: 'POST',
      body: JSON.stringify(data),
    }),

  get: (id: string): Promise<Company> => request(`/api/companies/${id}`),

  completeOnboarding: (id: string): Promise<Company> =>
    request(`/api/companies/${id}/onboarding-complete`, { method: 'POST' }),
};

// The license key is proof of purchase: it activates the workspace once and can recover access; sessions run on access tokens.
export const auth = {
  session: (): Promise<{ company: Company }> => request('/api/auth/session'),

  recover: (licenseKey: string): Promise<Activation> =>
    request('/api/auth/recover', {
      method: 'POST',
      body: JSON.stringify({ licenseKey }),
    }),
};

export const TOKEN_STORAGE_KEY = 'taro.accessToken';
// Legacy slot from before access tokens existed, migrated on load
export const LICENSE_STORAGE_KEY = 'taro.licenseKey';

export interface LicenseLookup {
  status: 'not_found' | 'unclaimed' | 'claimed';
  company?: Company;
}

export const licenses = {
  lookup: (licenseKey: string): Promise<LicenseLookup> =>
    request('/api/licenses/lookup', {
      method: 'POST',
      body: JSON.stringify({ licenseKey }),
    }),
};

export const meetings = {
  list: (companyId: string, archived = false): Promise<Meeting[]> =>
    request(`/api/meetings?companyId=${companyId}&archived=${archived ? '1' : '0'}`),

  clearHistory: (): Promise<{ archived: number }> =>
    request('/api/meetings/clear-history', { method: 'POST' }),

  get: (id: string): Promise<MeetingDetail> => request(`/api/meetings/${id}`),

  create: (data: { companyId: string; meetUrl: string }): Promise<Meeting> =>
    request('/api/meetings', {
      method: 'POST',
      body: JSON.stringify(data),
    }),

  end: (id: string): Promise<Meeting> =>
    request(`/api/meetings/${id}/end`, { method: 'POST' }),
};

// OAuth callbacks redirect back to whatever origin we launched from, so the flow returns to this site instead of the API's configured default.
function returnToParam(): string {
  if (typeof window === 'undefined') return '';
  return `&returnTo=${encodeURIComponent(window.location.origin)}`;
}

export const slack = {
  status: (companyId: string): Promise<SlackStatus> =>
    request(`/api/slack/status/${companyId}`),

  getInstallUrl: (companyId: string): string =>
    `${API_URL}/api/slack/install?companyId=${companyId}${returnToParam()}`,

  disconnect: (companyId: string): Promise<{ message: string }> =>
    request(`/api/slack/disconnect/${companyId}`, { method: 'DELETE' }),
};

// GitHub App installation; Taro acts as its own bot, never through a person's account.
export const github = {
  status: (companyId: string): Promise<GithubStatus> =>
    request(`/api/github/status/${companyId}`),

  getInstallUrl: (companyId: string): string =>
    `${API_URL}/api/github/install?companyId=${companyId}${returnToParam()}`,

  reconnect: (companyId: string): Promise<{ connected: boolean; repo?: string; accountLogin?: string }> =>
    request('/api/github/reconnect', {
      method: 'POST',
      body: JSON.stringify({ companyId }),
    }),

  repos: (companyId: string): Promise<{ repos: string[] }> =>
    request(`/api/github/repos/${companyId}`),

  setRepo: (data: { companyId: string; repo: string }): Promise<{ repo: string }> =>
    request('/api/github/repo', {
      method: 'POST',
      body: JSON.stringify(data),
    }),

  setCapabilities: (data: { companyId: string; actions: string[] }): Promise<{ enabledActions: string[] }> =>
    request('/api/github/capabilities', {
      method: 'POST',
      body: JSON.stringify(data),
    }),

  disconnect: (companyId: string): Promise<{ message: string }> =>
    request(`/api/github/disconnect/${companyId}`, { method: 'DELETE' }),
};

export const api = {
  companies,
  meetings,
  slack,
  github,
  licenses,
  auth,
};
