/**
 * Speech-to-text backend for the realtime pipeline. Two implementations:
 *
 *  - LocalBackend: the in-process sherpa-onnx recognizer. Free, zero setup,
 *    lower accuracy. Applies an energy + filler gate because the model
 *    hallucinates ("and", "oh") over silence.
 *  - RemoteBackend: forwards raw PCM to a local faster-whisper websocket
 *    server (see packages/api/stt-server) and receives finalized transcripts.
 *    Much higher accuracy, still 100% local/free; its VAD means no silence
 *    hallucinations. Enabled by setting STT_WS_URL.
 *
 * Both deliver finalized utterances through the same onUtterance callback, so
 * the realtime session is unaware of which one is running.
 */

import { WebSocket } from 'ws';
import { createAsrStream, type AsrStream, asrAvailable } from './asr';
import { pcmToFloat32 } from './audio';

// Peak int16 amplitude an utterance must reach to count as real speech.
const SPEECH_PEAK_MIN = 900;

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

export interface AsrBackend {
  readonly label: string;
  /** Feed one chunk of s16le 16 kHz mono PCM */
  push(chunk: Buffer): void;
  destroy(): void;
}

class LocalBackend implements AsrBackend {
  readonly label = 'local sherpa-onnx';
  private uttPeak = 0;

  constructor(
    private asr: AsrStream,
    private onUtterance: (text: string) => void
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
    // Drop silence hallucinations and filler-only noise before anyone sees it
    if (peak < SPEECH_PEAK_MIN || isNoiseUtterance(finalized)) return;
    this.onUtterance(finalized);
  }

  destroy() {
    this.asr.destroy();
  }
}

class RemoteBackend implements AsrBackend {
  readonly label: string;
  private ws: WebSocket | null = null;
  private open = false;
  private destroyed = false;
  private backlog: Buffer[] = [];

  constructor(
    private url: string,
    private onUtterance: (text: string) => void
  ) {
    this.label = `faster-whisper server (${url})`;
    this.connect();
  }

  private connect() {
    if (this.destroyed) return;
    const ws = new WebSocket(this.url);
    this.ws = ws;

    ws.on('open', () => {
      this.open = true;
      console.log(`[ASR] Connected to faster-whisper server at ${this.url}`);
      for (const c of this.backlog) ws.send(c);
      this.backlog = [];
    });
    ws.on('message', (data: Buffer) => {
      try {
        const { text } = JSON.parse(data.toString()) as { text?: string };
        if (text && text.trim() && !isNoiseUtterance(text)) this.onUtterance(text.trim());
      } catch {
        // ignore non-JSON frames
      }
    });
    ws.on('error', (error: Error) => {
      console.error(`[ASR] faster-whisper server error: ${error.message}`);
    });
    ws.on('close', () => {
      this.open = false;
      if (!this.destroyed) setTimeout(() => this.connect(), 2000); // reconnect for long meetings
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

/**
 * Pick the STT backend. If STT_WS_URL is set, use the faster-whisper server;
 * otherwise fall back to local sherpa-onnx. Returns null only when neither is
 * available (no server URL and the local model failed to load).
 */
export function createAsrBackend(onUtterance: (text: string) => void): AsrBackend | null {
  const url = process.env.STT_WS_URL;
  if (url) return new RemoteBackend(url, onUtterance);

  const asr = createAsrStream();
  if (!asr) return null;
  return new LocalBackend(asr, onUtterance);
}

/** Human-readable description of the active backend, for boot logs. */
export function asrBackendLabel(): string {
  if (process.env.STT_WS_URL) return `faster-whisper server at ${process.env.STT_WS_URL}`;
  return asrAvailable() ? 'local sherpa-onnx' : 'UNAVAILABLE';
}

/** Whether some STT backend can run (remote configured, or local model present). */
export function asrBackendAvailable(): boolean {
  return !!process.env.STT_WS_URL || asrAvailable();
}
