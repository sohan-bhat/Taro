import type { LlmProviderId } from '@taro/shared';

export interface LlmConfig {
  provider: LlmProviderId;
  apiKey: string;
  model: string;
  baseUrl?: string; // custom provider only
}

export interface JsonRequest {
  system: string;
  user: string;
  // JSON schema the response must match (objects need additionalProperties: false)
  schema: Record<string, unknown>;
}

export type LlmErrorKind = 'auth' | 'model' | 'rate_limit' | 'quota' | 'refusal' | 'bad_response' | 'network' | 'other';

/** Provider failures normalized into something a person can act on. */
export class LlmError extends Error {
  constructor(
    message: string,
    public kind: LlmErrorKind,
    public status?: number
  ) {
    super(message);
    this.name = 'LlmError';
  }
}

export interface KeyCheck {
  ok: boolean;
  error?: string;
}

export const REQUEST_TIMEOUT_MS = 30_000;
// Far above any real completion; a custom endpoint must not be able to stream forever into memory.
export const MAX_RESPONSE_BYTES = 1024 * 1024;

interface ReadableBody {
  body: { getReader(): { read(): Promise<{ done: boolean; value?: Uint8Array }>; cancel(): Promise<void> } } | null;
}

/** Reads a response body as text, giving up past MAX_RESPONSE_BYTES. */
export async function readCappedText(res: ReadableBody, maxBytes = MAX_RESPONSE_BYTES): Promise<string> {
  if (!res.body) return '';
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done || !value) break;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel().catch(() => {});
      throw new LlmError('The AI provider sent back far more data than expected, so Taro stopped reading.', 'bad_response');
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks).toString('utf8');
}

/** Pulls the human message out of a provider's JSON error body, if it has one. */
function errorText(detail: string): string {
  try {
    const parsed = JSON.parse(detail) as { error?: { message?: string } | string; message?: string };
    const message = typeof parsed.error === 'string' ? parsed.error : parsed.error?.message ?? parsed.message;
    if (message) return message;
  } catch {
    // not JSON
  }
  return detail;
}

/** Turns an HTTP failure from any provider into an LlmError with a useful message. */
export function httpFailure(providerName: string, status: number, detail: string): LlmError {
  const clean = errorText(detail).replace(/\s+/g, ' ').trim().slice(0, 240);
  if (status === 401 || status === 403) {
    return new LlmError(`${providerName} rejected the API key (${status}). Check the key in Setup.`, 'auth', status);
  }
  if (status === 404) {
    return new LlmError(`${providerName} could not find that model (404). Pick a different model in Setup.`, 'model', status);
  }
  if (status === 429) {
    const quota = /quota|billing|credit|exceeded your current/i.test(clean);
    return new LlmError(
      quota
        ? `${providerName} says this key is out of quota or credits.`
        : `${providerName} is rate limiting this key. Try again in a moment.`,
      quota ? 'quota' : 'rate_limit',
      status
    );
  }
  if (status === 503 || status === 529) {
    return new LlmError(`${providerName} is overloaded right now (${status}). It usually clears up within a minute.`, 'other', status);
  }
  return new LlmError(`${providerName} returned ${status}${clean ? `: ${clean}` : ''}`, 'other', status);
}

/** Models sometimes wrap JSON in a code fence even in JSON mode. */
export function parseJsonText(text: string): unknown {
  const trimmed = text.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
  try {
    return JSON.parse(trimmed);
  } catch {
    const start = trimmed.indexOf('{');
    const end = trimmed.lastIndexOf('}');
    if (start >= 0 && end > start) return JSON.parse(trimmed.slice(start, end + 1));
    throw new LlmError('The model did not return valid JSON.', 'bad_response');
  }
}
