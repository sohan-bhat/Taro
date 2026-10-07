/**
 * One POST to one webhook URL. It connects to the address resolveWebhookTarget checked (the name is
 * still sent for TLS and the Host header), gives up after 10 seconds, and never follows a redirect:
 * a 3xx is a failed attempt like any other non-2xx.
 */

import http from 'http';
import https from 'https';
import type { LookupFunction } from 'net';
import { env } from '../../config/env';
import { resolveWebhookTarget, WebhookUrlError } from './address';

const TIMEOUT_MS = 10_000;
// Only the start of a reply is kept, for the dashboard
const MAX_REPLY = 2_000;

export interface SendResult {
  ok: boolean;
  statusCode?: number;
  error?: string;
  durationMs: number;
}

export const allowLocalWebhooks = () => !env.isProduction;

export async function sendWebhook(rawUrl: string, body: string, headers: Record<string, string>): Promise<SendResult> {
  const started = Date.now();
  let target;
  try {
    target = await resolveWebhookTarget(rawUrl, { allowLocal: allowLocalWebhooks() });
  } catch (error) {
    return { ok: false, error: error instanceof WebhookUrlError ? error.message : 'Couldn\'t check the URL.', durationMs: Date.now() - started };
  }
  const { url, address, family } = target;
  const pinned: LookupFunction = (_host, options, callback) => {
    // Node asks for every address when autoSelectFamily is on
    if ((options as { all?: boolean }).all) (callback as (e: null, a: Array<{ address: string; family: number }>) => void)(null, [{ address, family }]);
    else callback(null, address, family);
  };

  return new Promise<SendResult>((resolve) => {
    let settled = false;
    const finish = (result: Omit<SendResult, 'durationMs'>) => {
      if (settled) return;
      settled = true;
      resolve({ ...result, durationMs: Date.now() - started });
    };
    const request = (url.protocol === 'https:' ? https : http).request(
      url,
      {
        method: 'POST',
        lookup: pinned,
        headers: { ...headers, 'Content-Length': Buffer.byteLength(body).toString() },
        timeout: TIMEOUT_MS,
      },
      (response) => {
        let reply = '';
        response.setEncoding('utf8');
        response.on('data', (chunk: string) => {
          if (reply.length < MAX_REPLY) reply += chunk;
        });
        response.on('end', () => {
          const code = response.statusCode ?? 0;
          const ok = code >= 200 && code < 300;
          finish({
            ok,
            statusCode: code,
            ...(ok ? {} : { error: code >= 300 && code < 400 ? `Redirected to ${response.headers.location ?? 'another address'}. Taro doesn't follow redirects, so use the final URL.` : reply.trim().slice(0, 300) || `Answered ${code}.` }),
          });
        });
        response.on('error', (error) => finish({ ok: false, statusCode: response.statusCode, error: error.message }));
      }
    );
    // The timeout covers the whole exchange, not just a quiet socket
    const timer = setTimeout(() => request.destroy(new Error('Timed out after 10 seconds.')), TIMEOUT_MS);
    request.on('timeout', () => request.destroy(new Error('Timed out after 10 seconds.')));
    request.on('error', (error) => finish({ ok: false, error: error.message }));
    request.on('close', () => clearTimeout(timer));
    request.end(body);
  });
}
