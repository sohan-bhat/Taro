/**
 * OpenAI, Groq, OpenRouter, and any custom OpenAI-compatible endpoint share
 * the Chat Completions wire format, so one adapter serves all four. JSON mode
 * (rather than strict JSON schema) is used because it is the subset every
 * compatible server actually implements; the caller validates the result.
 */

import { env } from '../../config/env';
import { getLlmProvider } from '@taro/shared';
import { safeFetch } from './safeFetch';
import {
  LlmError,
  REQUEST_TIMEOUT_MS,
  httpFailure,
  parseJsonText,
  readCappedText,
  type JsonRequest,
  type KeyCheck,
  type LlmConfig,
} from './types';

const BASE_URLS: Record<string, string> = {
  openai: 'https://api.openai.com/v1',
  groq: 'https://api.groq.com/openai/v1',
  openrouter: 'https://openrouter.ai/api/v1',
};

function baseUrl(config: LlmConfig): string {
  if (config.provider === 'custom') {
    if (!config.baseUrl) throw new LlmError('This custom provider has no base URL.', 'other');
    return config.baseUrl.replace(/\/$/, '');
  }
  return BASE_URLS[config.provider];
}

function providerName(config: LlmConfig): string {
  return getLlmProvider(config.provider)?.name ?? config.provider;
}

function headers(config: LlmConfig): Record<string, string> {
  return {
    Authorization: `Bearer ${config.apiKey}`,
    'Content-Type': 'application/json',
    // OpenRouter attributes traffic to an app by these optional headers
    ...(config.provider === 'openrouter' ? { 'HTTP-Referer': env.appUrl, 'X-Title': 'Taro' } : {}),
  };
}

async function request(config: LlmConfig, path: string, init: { method: string; body?: string }) {
  const url = `${baseUrl(config)}${path}`;
  const options = {
    method: init.method,
    headers: headers(config),
    body: init.body,
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  };
  try {
    // Only user-supplied endpoints go through the private-network guard
    return config.provider === 'custom' ? await safeFetch(url, options) : await fetch(url, options);
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    throw new LlmError(`Could not reach ${providerName(config)}: ${reason}`, 'network');
  }
}

export async function completeJsonOpenAICompatible(config: LlmConfig, req: JsonRequest): Promise<unknown> {
  const res = await request(config, '/chat/completions', {
    method: 'POST',
    body: JSON.stringify({
      model: config.model,
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: `${req.system}\n\nRespond with ONLY a single JSON object.` },
        { role: 'user', content: req.user },
      ],
      // Newer OpenAI reasoning models reject a non-default temperature; Groq's open models benefit from a low one.
      ...(config.provider === 'groq' ? { temperature: 0.2 } : {}),
    }),
  });

  const text = await readCappedText(res);
  if (!res.ok) throw httpFailure(providerName(config), res.status, text);

  let data: { choices?: { message?: { content?: string | null } }[] };
  try {
    data = JSON.parse(text);
  } catch {
    throw new LlmError(`${providerName(config)} sent a response that isn't JSON.`, 'bad_response');
  }
  const choice = data.choices?.[0];
  const content = choice?.message?.content;
  if (!content) {
    throw new LlmError(`${providerName(config)} returned an empty response.`, 'bad_response');
  }
  return parseJsonText(content);
}

export async function validateOpenAICompatible(config: LlmConfig): Promise<KeyCheck> {
  // OpenRouter's model list is public, so only its key endpoint proves the key works
  const path = config.provider === 'openrouter' ? '/key' : '/models';
  let res: Response | Awaited<ReturnType<typeof safeFetch>>;
  try {
    res = await request(config, path, { method: 'GET' });
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }

  if (res.ok) return { ok: true };
  if (res.status === 401 || res.status === 403) {
    return { ok: false, error: `${providerName(config)} rejected this key.` };
  }
  // Some compatible servers don't implement /models; prove the key with a tiny completion instead
  if (config.provider === 'custom' && (res.status === 404 || res.status === 405)) {
    try {
      await completeJsonOpenAICompatible(config, {
        system: 'Reply with {"ok": true}.',
        user: 'Return JSON.',
        schema: {},
      });
      return { ok: true };
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : String(error) };
    }
  }
  const detail = await readCappedText(res).catch(() => '');
  return { ok: false, error: httpFailure(providerName(config), res.status, detail).message };
}
