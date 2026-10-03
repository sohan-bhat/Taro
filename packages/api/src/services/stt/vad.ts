/**
 * Energy-based voice activity detection for 16 kHz s16le mono audio. Cloud
 * transcription APIs are batch, not streaming, so we cut the stream into
 * utterances here: buffer speech, and when the speaker pauses, emit it.
 *
 * Costs O(samples) per chunk: the pre-roll is a fixed ring buffer and an
 * utterance is a list of chunks joined once at the end.
 */

export const SAMPLE_RATE = 16000;

export interface VadOptions {
  onLevel?: number; // mean |sample| that starts speech
  offLevel?: number; // mean |sample| that ends it (hysteresis)
  prerollSamples?: number; // audio kept from before onset so the first word isn't clipped
  hangSamples?: number; // quiet needed to end an utterance
  minSamples?: number; // utterances with less voiced audio than this are dropped
  maxSamples?: number; // a monologue still gets cut and sent
}

const DEFAULTS: Required<VadOptions> = {
  onLevel: 700,
  offLevel: 450,
  prerollSamples: Math.floor(SAMPLE_RATE * 0.3),
  hangSamples: Math.floor(SAMPLE_RATE * 0.7),
  minSamples: Math.floor(SAMPLE_RATE * 0.4),
  maxSamples: SAMPLE_RATE * 20,
};

export class EnergyVad {
  private readonly opts: Required<VadOptions>;
  private readonly ring: Int16Array;
  private ringPos = 0;
  private ringLen = 0;
  private chunks: Int16Array[] = [];
  private segLen = 0;
  private prerollInSeg = 0;
  private inSpeech = false;
  private silenceRun = 0;

  constructor(
    private readonly onSegment: (samples: Int16Array) => void,
    options: VadOptions = {}
  ) {
    this.opts = { ...DEFAULTS, ...options };
    this.ring = new Int16Array(this.opts.prerollSamples);
  }

  push(chunk: Buffer): void {
    const n = chunk.length >> 1;
    if (n === 0) return;

    const samples = new Int16Array(n);
    let sum = 0;
    for (let i = 0; i < n; i++) {
      const v = chunk.readInt16LE(i * 2);
      samples[i] = v;
      sum += v < 0 ? -v : v;
    }
    const level = sum / n;

    if (!this.inSpeech) {
      if (level > this.opts.onLevel) {
        this.inSpeech = true;
        this.silenceRun = 0;
        const preroll = this.drainRing();
        this.chunks = preroll.length > 0 ? [preroll, samples] : [samples];
        this.segLen = preroll.length + n;
        this.prerollInSeg = preroll.length;
      } else {
        this.appendRing(samples);
      }
      return;
    }

    this.chunks.push(samples);
    this.segLen += n;
    if (level > this.opts.offLevel) {
      this.silenceRun = 0;
    } else {
      this.silenceRun += n;
      if (this.silenceRun >= this.opts.hangSamples) {
        this.endSegment();
        return;
      }
    }
    if (this.segLen >= this.opts.maxSamples) this.endSegment();
  }

  private endSegment(): void {
    const chunks = this.chunks;
    const length = this.segLen;
    // Judge length by the voiced part only; pre-roll and the trailing pause are padding.
    const voiced = length - this.prerollInSeg - this.silenceRun;
    this.inSpeech = false;
    this.chunks = [];
    this.segLen = 0;
    this.prerollInSeg = 0;
    this.silenceRun = 0;
    if (voiced < this.opts.minSamples) return;

    const joined = new Int16Array(length);
    let offset = 0;
    for (const c of chunks) {
      joined.set(c, offset);
      offset += c.length;
    }
    this.onSegment(joined);
  }

  private appendRing(samples: Int16Array): void {
    const cap = this.ring.length;
    if (cap === 0) return;
    // Only the newest `cap` samples can survive anyway
    const start = samples.length > cap ? samples.length - cap : 0;
    for (let i = start; i < samples.length; i++) {
      this.ring[this.ringPos] = samples[i];
      this.ringPos = (this.ringPos + 1) % cap;
    }
    this.ringLen = Math.min(cap, this.ringLen + (samples.length - start));
  }

  private drainRing(): Int16Array {
    const cap = this.ring.length;
    const out = new Int16Array(this.ringLen);
    const first = (this.ringPos - this.ringLen + cap) % cap;
    for (let i = 0; i < this.ringLen; i++) out[i] = this.ring[(first + i) % cap];
    this.ringLen = 0;
    this.ringPos = 0;
    return out;
  }
}

export function wavEncode(samples: Int16Array): Buffer {
  const bytes = samples.length * 2;
  const buf = Buffer.alloc(44 + bytes);
  buf.write('RIFF', 0);
  buf.writeUInt32LE(36 + bytes, 4);
  buf.write('WAVE', 8);
  buf.write('fmt ', 12);
  buf.writeUInt32LE(16, 16);
  buf.writeUInt16LE(1, 20); // PCM
  buf.writeUInt16LE(1, 22); // mono
  buf.writeUInt32LE(SAMPLE_RATE, 24);
  buf.writeUInt32LE(SAMPLE_RATE * 2, 28); // byte rate
  buf.writeUInt16LE(2, 32); // block align
  buf.writeUInt16LE(16, 34); // bits per sample
  buf.write('data', 36);
  buf.writeUInt32LE(bytes, 40);
  for (let i = 0; i < samples.length; i++) buf.writeInt16LE(samples[i], 44 + i * 2);
  return buf;
}
