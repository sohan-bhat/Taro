/**
 * Speech-to-text for the realtime pipeline. Every backend delivers finalized
 * utterances through the same callback, so the realtime session doesn't care
 * which one runs:
 *
 *  - CloudWhisperBackend: the workspace's own Groq or OpenAI key. Energy VAD
 *    cuts utterances locally and each one is posted to the transcription API.
 *  - RemoteBackend: a faster-whisper server the operator runs (STT_WS_URL).
 *  - LocalBackend: in-process sherpa-onnx (LOCAL_ASR=1). Free, CPU heavy,
 *    meant for development and small self-hosted installs.
 */

import { WebSocket } from 'ws';
import { COPY, type SttProviderId } from '@taro/shared';
import { env } from '../../config/env';
import { log, errorMessage } from '../../lib/logger';
import { createAsrStream, type AsrStream } from '../asr';
import { pcmToFloat32 } from '../audio';
import { EnergyVad, wavEncode } from './vad';
import type { KeyCheck } from '../llm';

export interface SttBackend {
  readonly label: string;
  /** Feed one chunk of s16le 16 kHz mono PCM */
  push(chunk: Buffer): void;
  destroy(): void;
}

export type SttRuntimeConfig =
  | { provider: 'groq' | 'openai'; apiKey: string; model: string }
  | { provider: 'server' };

// Utterances that are ONLY these words are recognizer noise, not speech.
// Greetings (hey/he/hi) are excluded so the wake phrase always survives.
const FILLER_WORDS = new Set([
  'and', 'oh', 'yes', 'yeah', 'um', 'uh', 'er', 'ah', 'mm', 'hmm', 'mhm', 'huh',
  'so', 'the', 'a', 'i', 'you', 'it', 'is', 'to', 'of', 'ok', 'okay', 'right', 'like',
]);

export function isNoiseUtterance(text: string): boolean {
  const words = text.toLowerCase().match(/[a-z']+/g);
  if (!words || words.length === 0) return true;
  return words.every((w) => FILLER_WORDS.has(w));
}

const CLOUD_BASE: Record<'groq' | 'openai', { url: string; name: string }> = {
  groq: { url: 'https://api.groq.com/openai/v1', name: 'Groq' },
  openai: { url: 'https://api.openai.com/v1', name: 'OpenAI' },
};

// Drop new utterances rather than build an ever-growing lag when the API backs up
const MAX_IN_FLIGHT = 3;

class CloudWhisperBackend implements SttBackend {
  readonly label: string;
  private readonly vad: EnergyVad;
  private inFlight = 0;
  private destroyed = false;
  private authFailed = false;

  constructor(
    private readonly config: { provider: 'groq' | 'openai'; apiKey: string; model: string },
    private readonly onUtterance: (text: string) => void,
    private readonly onFatal: (message: string) => void
  ) {
    this.label = `${CLOUD_BASE[config.provider].name} transcription (${config.model})`;
    this.vad = new EnergyVad((samples) => this.transcribe(samples));
  }

  push(chunk: Buffer) {
    if (this.destroyed || this.authFailed) return;
    this.vad.push(chunk);
  }

  private async transcribe(samples: Int16Array) {
    if (this.inFlight >= MAX_IN_FLIGHT) return;
    this.inFlight++;
    try {
      const form = new FormData();
      form.append('file', new Blob([new Uint8Array(wavEncode(samples))], { type: 'audio/wav' }), 'audio.wav');
      form.append('model', this.config.model);
      form.append('language', 'en');
      form.append('temperature', '0');
      // No prompt: Whisper echoes prompt text into near-silent segments, which once surfaced as a fake command.
      form.append('response_format', 'json');

      const res = await fetch(`${CLOUD_BASE[this.config.provider].url}/audio/transcriptions`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${this.config.apiKey}` },
        body: form,
        signal: AbortSignal.timeout(20_000),
      });
      if (!res.ok) {
        const body = (await res.text()).slice(0, 200);
        if (res.status === 401 || res.status === 403) {
          // A bad key won't fix itself mid-call; stop retrying and tell the session once.
          this.authFailed = true;
          this.onFatal(COPY.transcriptionKeyRejected(CLOUD_BASE[this.config.provider].name));
        }
        log.warn(`[STT] ${this.config.provider} ${res.status}: ${body}`);
        return;
      }
      const data = (await res.json()) as { text?: string };
      const text = (data.text || '').trim();
      if (text && !isNoiseUtterance(text)) this.onUtterance(text);
    } catch (error) {
      log.warn(`[STT] ${this.config.provider} request failed: ${errorMessage(error)}`);
    } finally {
      this.inFlight--;
    }
  }

  destroy() {
    this.destroyed = true;
  }
}

class RemoteBackend implements SttBackend {
  readonly label: string;
  private ws: WebSocket | null = null;
  private open = false;
  private destroyed = false;
  private backlog: Buffer[] = [];

  constructor(
    private readonly url: string,
    private readonly onUtterance: (text: string) => void
  ) {
    this.label = 'self-hosted faster-whisper';
    this.connect();
  }

  private connect() {
    if (this.destroyed) return;
    const ws = new WebSocket(this.url);
    this.ws = ws;
    ws.on('open', () => {
      this.open = true;
      for (const c of this.backlog) ws.send(c);
      this.backlog = [];
    });
    ws.on('message', (data: Buffer) => {
      try {
        const { text } = JSON.parse(data.toString()) as { text?: string };
        if (text && text.trim() && !isNoiseUtterance(text)) this.onUtterance(text.trim());
      } catch {
        // not a transcript frame
      }
    });
    ws.on('error', (error: Error) => log.warn(`[STT] faster-whisper server error: ${error.message}`));
    ws.on('close', () => {
      this.open = false;
      if (!this.destroyed) setTimeout(() => this.connect(), 2000);
    });
  }

  push(chunk: Buffer) {
    if (this.open && this.ws) {
      this.ws.send(chunk);
    } else if (this.backlog.length < 400) {
      // Buffer briefly while (re)connecting, then drop to avoid unbounded growth
      this.backlog.push(chunk);
    }
  }

  destroy() {
    this.destroyed = true;
    try {
      this.ws?.close();
    } catch {
      // already closed
    }
  }
}

// sherpa-onnx hallucinates short words over silence, so gate on loudness and filler.
const SPEECH_PEAK_MIN = 900;

class LocalBackend implements SttBackend {
  readonly label = 'local sherpa-onnx';
  private uttPeak = 0;

  constructor(
    private readonly asr: AsrStream,
    private readonly onUtterance: (text: string) => void
  ) {}

  push(chunk: Buffer) {
    for (let i = 0; i + 1 < chunk.length; i += 2) {
      const v = Math.abs(chunk.readInt16LE(i));
      if (v > this.uttPeak) this.uttPeak = v;
    }
    const finalized = this.asr.accept(pcmToFloat32(chunk));
    if (!finalized) return;
    const peak = this.uttPeak;
    this.uttPeak = 0;
    if (peak < SPEECH_PEAK_MIN || isNoiseUtterance(finalized)) return;
    this.onUtterance(finalized);
  }

  destroy() {
    this.asr.destroy();
  }
}

function createServerBackend(onUtterance: (text: string) => void): SttBackend | null {
  if (env.sttWsUrl) return new RemoteBackend(env.sttWsUrl, onUtterance);
  if (env.localAsr) {
    const asr = createAsrStream();
    if (asr) return new LocalBackend(asr, onUtterance);
  }
  return null;
}

/** Null when the workspace has no transcription configured and the server hosts none. */
export function createSttBackend(
  config: SttRuntimeConfig | null,
  onUtterance: (text: string) => void,
  onFatal: (message: string) => void
): SttBackend | null {
  if (config && config.provider !== 'server') {
    return new CloudWhisperBackend(config, onUtterance, onFatal);
  }
  return createServerBackend(onUtterance);
}

export async function validateSttKey(provider: SttProviderId, apiKey: string): Promise<KeyCheck> {
  if (provider === 'server') return { ok: true };
  const base = CLOUD_BASE[provider];
  try {
    const res = await fetch(`${base.url}/models`, {
      headers: { Authorization: `Bearer ${apiKey}` },
      signal: AbortSignal.timeout(15_000),
    });
    if (res.ok) return { ok: true };
    if (res.status === 401 || res.status === 403) return { ok: false, error: `${base.name} rejected this key.` };
    return { ok: false, error: `${base.name} returned ${res.status}.` };
  } catch (error) {
    return { ok: false, error: `Could not reach ${base.name}: ${errorMessage(error)}` };
  }
}
