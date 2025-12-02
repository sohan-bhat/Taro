/**
 * Typed API client for Taro backend.
 * Centralizes all fetch calls with consistent error handling.
 */

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000';

// API error with structured response
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

// Response types
export interface Company {
  _id: string;
  name: string;
  domain: string;
  createdAt: string;
  updatedAt: string;
}

export interface Meeting {
  _id: string;
  companyId: string;
  meetUrl: string;
  status: 'pending' | 'joining' | 'active' | 'ended' | 'error';
  startedAt?: string;
  endedAt?: string;
  createdAt: string;
  updatedAt: string;
}

export interface SlackStatus {
  connected: boolean;
  teamName?: string;
  connectedAt?: string;
}

// Generic request handler
async function request<T>(
  endpoint: string,
  options: RequestInit = {}
): Promise<T> {
  const url = `${API_URL}${endpoint}`;

  const response = await fetch(url, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...options.headers,
    },
  });

  // Handle non-OK responses
  if (!response.ok) {
    let errorData: { error?: string; code?: string; requestId?: string } = {};
    try {
      errorData = await response.json();
    } catch {
      // Response wasn't JSON
    }

    throw new ApiError(
      response.status,
      errorData.code || 'UNKNOWN_ERROR',
      errorData.error || `Request failed with status ${response.status}`,
      errorData.requestId
    );
  }

  // Handle empty responses (204 No Content)
  if (response.status === 204) {
    return undefined as T;
  }

  return response.json();
}

// Company endpoints
export const companies = {
  create: (data: { name: string; domain: string }): Promise<Company> =>
    request('/api/companies', {
      method: 'POST',
      body: JSON.stringify(data),
    }),

  get: (id: string): Promise<Company> => request(`/api/companies/${id}`),

  list: (): Promise<Company[]> => request('/api/companies'),
};

// Meeting endpoints
export const meetings = {
  list: (companyId: string): Promise<Meeting[]> =>
    request(`/api/meetings?companyId=${companyId}`),

  get: (id: string): Promise<Meeting> => request(`/api/meetings/${id}`),

  create: (data: { companyId: string; meetUrl: string }): Promise<Meeting> =>
    request('/api/meetings', {
      method: 'POST',
      body: JSON.stringify(data),
    }),

  end: (id: string): Promise<Meeting> =>
    request(`/api/meetings/${id}/end`, { method: 'POST' }),
};

// Slack endpoints
export const slack = {
  status: (companyId: string): Promise<SlackStatus> =>
    request(`/api/slack/status/${companyId}`),

  getInstallUrl: (companyId: string): string =>
    `${API_URL}/api/slack/install?companyId=${companyId}`,

  disconnect: (companyId: string): Promise<{ message: string }> =>
    request(`/api/slack/disconnect/${companyId}`, { method: 'DELETE' }),
};

// Export grouped API
export const api = {
  companies,
  meetings,
  slack,
};
