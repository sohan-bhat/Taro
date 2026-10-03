/**
 * Claude via the official Anthropic SDK. Uses structured outputs
 * (output_config.format) so the response is schema-valid JSON, never sends
 * sampling parameters or an assistant prefill (both rejected by current
 * models), and opts into server-side refusal fallback on the models that
 * support it.
 */

import Anthropic from '@anthropic-ai/sdk';
import { LlmError, REQUEST_TIMEOUT_MS, parseJsonText, type JsonRequest, type KeyCheck, type LlmConfig } from './types';

// Current-generation models take output_config.effort; Haiku 4.5 and older reject it.
function supportsEffort(model: string): boolean {
  return !/haiku|claude-3|sonnet-4-5|opus-4-5|opus-4-1|opus-4-0|sonnet-4-0/.test(model);
}

// Server-side refusal fallback ("default" form) is offered on these models.
function supportsFallbacks(model: string): boolean {
  return /^claude-(opus-5-5|opus-5|sonnet-5-5|fable-5-1|fable-5)$/.test(model);
}

function client(apiKey: string): Anthropic {
  return new Anthropic({ apiKey, maxRetries: 1, timeout: REQUEST_TIMEOUT_MS });
}

function toLlmError(error: unknown): LlmError {
  if (error instanceof LlmError) return error;
  if (error instanceof Anthropic.AuthenticationError || error instanceof Anthropic.PermissionDeniedError) {
    return new LlmError('Anthropic rejected the API key. Check the key in Setup.', 'auth', error.status);
  }
  if (error instanceof Anthropic.NotFoundError) {
    return new LlmError('Anthropic could not find that model. Pick a different model in Setup.', 'model', 404);
  }
  if (error instanceof Anthropic.RateLimitError) {
    return new LlmError('Anthropic is rate limiting this key. Try again in a moment.', 'rate_limit', 429);
  }
  if (error instanceof Anthropic.BadRequestError) {
    const message = error.message.replace(/\s+/g, ' ').slice(0, 240);
    const quota = /credit balance|billing/i.test(message);
    return new LlmError(
      quota ? 'Your Anthropic account is out of credits.' : `Anthropic rejected the request: ${message}`,
      quota ? 'quota' : 'other',
      400
    );
  }
  if (error instanceof Anthropic.APIConnectionError) {
    return new LlmError('Could not reach Anthropic.', 'network');
  }
  if (error instanceof Anthropic.APIError) {
    return new LlmError(`Anthropic returned ${error.status ?? 'an error'}: ${error.message}`, 'other', error.status);
  }
  return new LlmError(error instanceof Error ? error.message : String(error), 'other');
}

export async function completeJsonAnthropic(config: LlmConfig, req: JsonRequest): Promise<unknown> {
  const anthropic = client(config.apiKey);
  const outputConfig = {
    // Live meetings are latency sensitive and this is extraction plus short writing.
    ...(supportsEffort(config.model) ? { effort: 'low' as const } : {}),
    format: { type: 'json_schema' as const, schema: req.schema },
  };

  try {
    const message = supportsFallbacks(config.model)
      ? await anthropic.beta.messages.create({
          model: config.model,
          max_tokens: 16000,
          system: req.system,
          messages: [{ role: 'user', content: req.user }],
          output_config: outputConfig,
          betas: ['server-side-fallback-2026-07-01'],
          fallbacks: 'default',
        })
      : await anthropic.messages.create({
          model: config.model,
          max_tokens: 16000,
          system: req.system,
          messages: [{ role: 'user', content: req.user }],
          output_config: outputConfig,
        });

    if (message.stop_reason === 'refusal') {
      throw new LlmError('Claude declined this request.', 'refusal');
    }
    if (message.stop_reason === 'max_tokens') {
      throw new LlmError('Claude ran out of room before finishing its answer.', 'bad_response');
    }

    // Thinking blocks come first on current models; the answer is in the text blocks.
    let text = '';
    for (const block of message.content) {
      if (block.type === 'text') text += block.text;
    }
    if (!text) throw new LlmError('Claude returned an empty response.', 'bad_response');
    return parseJsonText(text);
  } catch (error) {
    throw toLlmError(error);
  }
}

export async function validateAnthropic(config: LlmConfig): Promise<KeyCheck> {
  try {
    // Listing models is free and fails with 401 on a bad key.
    await client(config.apiKey).models.list({ limit: 1 });
    return { ok: true };
  } catch (error) {
    // Shown in the key dialog itself, like the other providers' checks
    const failure = toLlmError(error);
    return { ok: false, error: failure.kind === 'auth' ? 'Anthropic rejected this key.' : failure.message };
  }
}
