import { GoogleGenAI, ApiError } from '@google/genai';
import { LlmError, REQUEST_TIMEOUT_MS, httpFailure, parseJsonText, type JsonRequest, type KeyCheck, type LlmConfig } from './types';

const MODELS_URL = 'https://generativelanguage.googleapis.com/v1beta/models?pageSize=1';

function toLlmError(error: unknown): LlmError {
  if (error instanceof LlmError) return error;
  if (error instanceof ApiError) {
    // Gemini answers a bad key with 400 "API key not valid" rather than 401
    if (error.status === 400 && /api key/i.test(error.message)) {
      return new LlmError('Google rejected the API key. Check the key in Setup.', 'auth', 400);
    }
    return httpFailure('Google', error.status, error.message);
  }
  return new LlmError(error instanceof Error ? error.message : String(error), 'network');
}

export async function completeJsonGemini(config: LlmConfig, req: JsonRequest): Promise<unknown> {
  const ai = new GoogleGenAI({ apiKey: config.apiKey });
  try {
    const response = await ai.models.generateContent({
      model: config.model,
      contents: req.user,
      config: {
        systemInstruction: req.system,
        responseMimeType: 'application/json',
        responseJsonSchema: req.schema,
        abortSignal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      },
    });
    const text = response.text;
    if (!text) throw new LlmError('Gemini returned an empty response.', 'bad_response');
    return parseJsonText(text);
  } catch (error) {
    throw toLlmError(error);
  }
}

export async function validateGemini(config: LlmConfig): Promise<KeyCheck> {
  try {
    // Header rather than ?key= so the key never lands in a URL or access log
    const res = await fetch(MODELS_URL, {
      headers: { 'x-goog-api-key': config.apiKey },
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    if (res.ok) return { ok: true };
    const body = await res.text();
    if (res.status === 400 || res.status === 401 || res.status === 403) {
      return { ok: false, error: 'Google rejected this key.' };
    }
    return { ok: false, error: httpFailure('Google', res.status, body).message };
  } catch (error) {
    return { ok: false, error: `Could not reach Google: ${error instanceof Error ? error.message : String(error)}` };
  }
}
