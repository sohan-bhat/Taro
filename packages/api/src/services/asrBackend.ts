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

// ── Groq Whisper (cloud, free tier) ──────────────────────────────────────
// Groq's transcription API is batch, not streaming, so we do voice-activity
// detection here: buffer speech, and when the speaker pauses, send that one
// utterance to Groq. Scalable cloud STT, nothing runs on the user's machine.
const GROQ_URL = 'https://api.groq.com/openai/v1/audio/transcriptions';
const GROQ_MODEL = process.env.GROQ_STT_MODEL || 'whisper-large-v3-turbo';
const SR = 16000;
// Energy VAD tuning (mean |sample| on the int16 scale)
const VAD_ON = 700; // rises into speech
const VAD_OFF = 450; // falls out of speech (hysteresis)
const PREROLL = Math.floor(SR * 0.3); // keep 300ms before onset so we don't clip
const SILENCE_HANG = Math.floor(SR * 0.7); // 700ms of quiet ends an utterance
const MIN_SAMPLES = Math.floor(SR * 0.4); // ignore blips under 0.4s
const MAX_SAMPLES = SR * 20; // hard cap so a monologue still gets sent

function wavEncode(samples: Int16Array): Buffer {
  const bytes = samples.length * 2;
  const buf = Buffer.alloc(44 + bytes);
  buf.write('RIFF', 0);
  buf.writeUInt32LE(36 + bytes, 4);
  buf.write('WAVE', 8);
  buf.write('fmt ', 12);
  buf.writeUInt32LE(16, 16);
  buf.writeUInt16LE(1, 20); // PCM
  buf.writeUInt16LE(1, 22); // mono
  buf.writeUInt32LE(SR, 24);
  buf.writeUInt32LE(SR * 2, 28); // byte rate
  buf.writeUInt16LE(2, 32); // block align
  buf.writeUInt16LE(16, 34); // bits/sample
  buf.write('data', 36);
  buf.writeUInt32LE(bytes, 40);
  for (let i = 0; i < samples.length; i++) buf.writeInt16LE(samples[i], 44 + i * 2);
  return buf;
}

class GroqBackend implements AsrBackend {
  readonly label = `Groq Whisper (${GROQ_MODEL})`;
  private seg: number[] = [];
  private preroll: number[] = [];
  private inSpeech = false;
  private silenceRun = 0;
  private pending = 0;
  private destroyed = false;

  constructor(
    private apiKey: string,
    private onUtterance: (text: string) => void
  ) {}

  push(chunk: Buffer) {
    if (this.destroyed) return;
    const n = chunk.length >> 1;
    if (n === 0) return;

    let sum = 0;
    for (let i = 0; i < n; i++) sum += Math.abs(chunk.readInt16LE(i * 2));
    const level = sum / n;
    const speech = level > (this.inSpeech ? VAD_OFF : VAD_ON);

    for (let i = 0; i < n; i++) {
      const sample = chunk.readInt16LE(i * 2);
      if (this.inSpeech) {
        this.seg.push(sample);
      } else {
        this.preroll.push(sample);
        if (this.preroll.length > PREROLL) this.preroll.shift();
      }
    }

    if (speech) {
      if (!this.inSpeech) {
        this.inSpeech = true;
        this.seg = this.preroll.slice(); // carry the onset
        this.preroll = [];
      }
      this.silenceRun = 0;
    } else if (this.inSpeech) {
      this.silenceRun += n;
      if (this.silenceRun >= SILENCE_HANG) this.endSegment();
    }
    if (this.inSpeech && this.seg.length >= MAX_SAMPLES) this.endSegment();
  }

  private endSegment() {
    const samples = this.seg;
    this.inSpeech = false;
    this.seg = [];
    this.silenceRun = 0;
    if (samples.length < MIN_SAMPLES) return;
    // Stay realtime: if requests are backing up (rate limit / slow network),
    // drop this segment rather than queue an ever-growing lag.
    if (this.pending >= 2) return;
    void this.transcribe(Int16Array.from(samples));
  }

  private async transcribe(samples: Int16Array) {
    this.pending++;
    try {
      const form = new FormData();
      // Copy into a fresh Uint8Array so the Blob part is a plain ArrayBuffer
      const wav = new Uint8Array(wavEncode(samples));
      form.append('file', new Blob([wav], { type: 'audio/wav' }), 'audio.wav');
      form.append('model', GROQ_MODEL);
      form.append('language', 'en');
      form.append('temperature', '0');
      // No prompt: Whisper echoes the prompt text into near-silent segments
      // (it leaked as a fake "post to Slack, create a GitHub" command).
      form.append('response_format', 'json');

      const res = await fetch(GROQ_URL, {
        method: 'POST',
        headers: { Authorization: `Bearer ${this.apiKey}` },
        body: form,
      });
      if (!res.ok) {
        const body = await res.text();
        console.error(`[ASR] Groq ${res.status}: ${body.slice(0, 200)}`);
        return;
      }
      const data = (await res.json()) as { text?: string };
      const text = (data.text || '').trim();
      if (text && !isNoiseUtterance(text)) this.onUtterance(text);
    } catch (error) {
      console.error('[ASR] Groq request failed:', error instanceof Error ? error.message : error);
    } finally {
      this.pending--;
    }
  }

  destroy() {
    this.destroyed = true;
  }
}

/**
 * Pick the STT backend. If STT_WS_URL is set, use the faster-whisper server;
 * otherwise fall back to local sherpa-onnx. Returns null only when neither is
 * available (no server URL and the local model failed to load).
 */
export function createAsrBackend(onUtterance: (text: string) => void): AsrBackend | null {
  if (process.env.GROQ_API_KEY) return new GroqBackend(process.env.GROQ_API_KEY, onUtterance);
  if (process.env.STT_WS_URL) return new RemoteBackend(process.env.STT_WS_URL, onUtterance);

  const asr = createAsrStream();
  if (!asr) return null;
  return new LocalBackend(asr, onUtterance);
}

/** Human-readable description of the active backend, for boot logs. */
export function asrBackendLabel(): string {
  if (process.env.GROQ_API_KEY) return `Groq Whisper (${GROQ_MODEL})`;
  if (process.env.STT_WS_URL) return `faster-whisper server at ${process.env.STT_WS_URL}`;
  return asrAvailable() ? 'local sherpa-onnx' : 'UNAVAILABLE';
}

/** Whether some STT backend can run (remote configured, or local model present). */
export function asrBackendAvailable(): boolean {
  return !!process.env.GROQ_API_KEY || !!process.env.STT_WS_URL || asrAvailable();
}
