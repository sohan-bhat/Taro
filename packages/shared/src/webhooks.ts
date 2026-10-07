// Outgoing webhooks: what a workspace can send to its own URLs, and the shapes the dashboard shows.

export const WEBHOOK_EVENTS = [
  {
    type: 'meeting.started',
    label: 'Meeting started',
    description: 'Taro is in a call and hearing it',
  },
  {
    type: 'meeting.ended',
    label: 'Meeting ended',
    description: 'The recap, every request, and the transcript',
  },
  {
    type: 'request.completed',
    label: 'Request handled',
    description: 'Each thing someone asked Taro for, and how it went',
  },
] as const;

// webhook.test only ever goes to the one endpoint someone pressed Send test on.
export type WebhookEventType = (typeof WEBHOOK_EVENTS)[number]['type'] | 'webhook.test';

export const WEBHOOK_EVENT_TYPES: readonly string[] = WEBHOOK_EVENTS.map((e) => e.type);

export const MAX_WEBHOOK_ENDPOINTS = 5;

export interface WebhookEndpoint {
  _id: string;
  url: string;
  description?: string;
  events: string[];
  enabled: boolean;
  // Taro turned it off after it kept failing for days
  disabledForFailures?: boolean;
  // When deliveries started failing in a row; unset while they succeed
  failingSince?: string;
  secretHint: string;
  createdAt: string;
}

export interface WebhookDelivery {
  _id: string;
  eventId: string;
  type: WebhookEventType;
  status: 'pending' | 'delivered' | 'failed';
  attempts: number;
  statusCode?: number;
  error?: string;
  durationMs?: number;
  nextAttemptAt?: string;
  createdAt: string;
  deliveredAt?: string;
}
