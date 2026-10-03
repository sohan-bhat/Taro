import { completeJsonAnthropic, validateAnthropic } from './anthropic';
import { completeJsonGemini, validateGemini } from './gemini';
import { completeJsonOpenAICompatible, validateOpenAICompatible } from './openaiCompatible';
import { assertEndpointAllowed } from './safeFetch';
import type { JsonRequest, KeyCheck, LlmConfig } from './types';

export { LlmError, type LlmConfig, type KeyCheck } from './types';

/** Runs one structured request against whichever provider the workspace chose. */
export function completeJson(config: LlmConfig, req: JsonRequest): Promise<unknown> {
  switch (config.provider) {
    case 'anthropic':
      return completeJsonAnthropic(config, req);
    case 'google':
      return completeJsonGemini(config, req);
    case 'openai':
    case 'groq':
    case 'openrouter':
    case 'custom':
      return completeJsonOpenAICompatible(config, req);
  }
}

export async function validateLlmKey(config: LlmConfig): Promise<KeyCheck> {
  if (config.provider === 'custom') {
    if (!config.baseUrl) return { ok: false, error: 'Enter the base URL of your API.' };
    if (!config.model) return { ok: false, error: 'Enter the model name your API expects.' };
    try {
      assertEndpointAllowed(config.baseUrl);
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : String(error) };
    }
  }
  switch (config.provider) {
    case 'anthropic':
      return validateAnthropic(config);
    case 'google':
      return validateGemini(config);
    default:
      return validateOpenAICompatible(config);
  }
}
