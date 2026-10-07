/**
 * The pure half of outgoing webhooks: event bodies, signatures, and when to try again. Nothing here
 * touches the database or the network.
 */

import crypto from 'crypto';
import type { ActionOutcome, IntentParams, WebhookEventType } from '@taro/shared';
import { randomToken } from '../../lib/crypto';

// Long transcripts are cut so one event stays well under what receivers accept
const MAX_TRANSCRIPT = 200_000;

export interface WebhookEvent {
  id: string;
  type: WebhookEventType;
  createdAt: string;
  workspaceId: string;
  data: Record<string, unknown>;
}

export function makeEvent(type: WebhookEventType, workspaceId: string, data: Record<string, unknown>, now = new Date()): WebhookEvent {
  return { id: `evt_${randomToken(16)}`, type, createdAt: now.toISOString(), workspaceId, data };
}

export const newSecret = () => `whsec_${randomToken(32)}`;

/** Taro-Signature: t=<unix seconds>,v1=<hex HMAC-SHA256 of "<t>.<body>" keyed with the whole secret>. */
export function signatureHeader(secret: string, body: string, unixSeconds: number): string {
  const v1 = crypto.createHmac('sha256', secret).update(`${unixSeconds}.${body}`).digest('hex');
  return `t=${unixSeconds},v1=${v1}`;
}

/** The receiving side's check, as the docs describe it. Used by tests and the docs example. */
export function verifySignature(secret: string, body: string, header: string, nowSeconds: number, toleranceSeconds = 300): boolean {
  const parts = Object.fromEntries(header.split(',').map((p) => p.split('=', 2) as [string, string]));
  const t = Number(parts.t);
  if (!Number.isInteger(t) || !parts.v1 || Math.abs(nowSeconds - t) > toleranceSeconds) return false;
  const expected = Buffer.from(signatureHeader(secret, body, t).split('v1=')[1], 'hex');
  const given = Buffer.from(parts.v1, 'hex');
  return given.length === expected.length && crypto.timingSafeEqual(given, expected);
}

// Waits before attempts 2 to 5. After the fifth fails, the delivery has failed.
export const RETRY_DELAYS_MS = [30_000, 5 * 60_000, 30 * 60_000, 2 * 60 * 60_000] as const;

/** When to try again after `attempts` tries have failed, or null when it's done trying. */
export function nextAttemptAfter(attempts: number, now: number): Date | null {
  const wait = RETRY_DELAYS_MS[attempts - 1];
  return wait === undefined ? null : new Date(now + wait);
}

// Turned off after failing this long with no success in between
export const DISABLE_AFTER_MS = 3 * 24 * 60 * 60_000;

export function shouldDisable(failingSince: Date | undefined, now: number): boolean {
  return !!failingSince && now - failingSince.getTime() >= DISABLE_AFTER_MS;
}

/** Slack's <url|text> links, written out for receivers that aren't Slack: "text (url)". */
export function plainLinks(s: string): string {
  return s.replace(/<(https?:\/\/[^|>\s]+)\|([^>]+)>/g, '$2 ($1)').replace(/<(https?:\/\/[^|>\s]+)>/g, '$1');
}

const firstUrl = (s?: string | null) => s?.match(/https?:\/\/\S+/)?.[0];

export interface MeetingFields {
  _id: unknown;
  title?: string;
  meetUrl: string;
  platform?: string;
  source?: string;
  status: string;
  startedByName?: string;
  startedAt?: Date;
  endedAt?: Date;
  transcript?: string;
  liveTranscript?: string;
}

function meetingData(m: MeetingFields) {
  return {
    id: String(m._id),
    title: m.title ?? null,
    url: m.meetUrl,
    platform: m.platform ?? null,
    source: m.source ?? null,
    status: m.status,
    startedBy: m.startedByName ?? null,
    startedAt: m.startedAt?.toISOString() ?? null,
    endedAt: m.endedAt?.toISOString() ?? null,
  };
}

export interface RequestFields {
  command: string;
  intent?: { action?: string; params?: IntentParams };
  outcome?: ActionOutcome;
  status?: string;
  summary?: string;
  result?: string;
  createdAt?: Date;
}

function requestData(r: RequestFields) {
  const outcome: ActionOutcome =
    r.outcome ?? (r.status === 'success' ? 'done' : r.status === 'failed' ? 'failed' : 'needs_you');
  const { original: _original, ...params } = r.intent?.params ?? {};
  return {
    command: r.command,
    action: r.intent?.action ?? 'unknown',
    params,
    outcome,
    summary: r.summary ? plainLinks(r.summary) : null,
    url: outcome === 'done' ? firstUrl(r.result) ?? null : null,
    at: r.createdAt?.toISOString() ?? null,
  };
}

export const meetingStartedData = (m: MeetingFields) => ({ meeting: meetingData(m) });

export function meetingEndedData(m: MeetingFields, requests: readonly RequestFields[], recap: readonly string[]) {
  const transcript = m.transcript || m.liveTranscript || '';
  return {
    meeting: meetingData(m),
    recap: recap.map(plainLinks),
    requests: requests.map(requestData),
    transcript: transcript ? transcript.slice(0, MAX_TRANSCRIPT) : null,
    transcriptTruncated: transcript.length > MAX_TRANSCRIPT,
  };
}

export const requestCompletedData = (meetingId: string, r: RequestFields) => ({ meetingId, request: requestData(r) });

export const testData = (endpointId: string) => ({
  endpointId,
  message: 'This is a test event from Taro. If you can read this, your endpoint works.',
});
