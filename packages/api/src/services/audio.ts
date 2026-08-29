/**
 * Audio utilities for the realtime pipeline.
 * All audio is 16 kHz, 16-bit signed little-endian, mono: the format
 * MeetingBaas streams in and accepts back.
 */

export const SAMPLE_RATE = 16000;

/**
 * Convert a raw s16le PCM buffer to Float32 samples in [-1, 1]
 * (the input format sherpa-onnx expects).
 */
export function pcmToFloat32(pcm: Buffer): Float32Array {
  const samples = new Float32Array(Math.floor(pcm.length / 2));
  for (let i = 0; i < samples.length; i++) {
    samples[i] = pcm.readInt16LE(i * 2) / 32768;
  }
  return samples;
}

// Played into the meeting via the MeetingBaas output stream when a command
// completes. A soft harmonic overtone makes the two-note chime (C6 -> E6)
// read as a notification rather than a flat sine beep.
export function makeDingPcm(): Buffer {
  const toneDuration = 0.24; // seconds per tone
  const gap = 0.03;
  const tones = [1046.5, 1318.5];
  const totalSamples = Math.floor(SAMPLE_RATE * (tones.length * (toneDuration + gap)));
  const buf = Buffer.alloc(totalSamples * 2);

  let offset = 0;
  for (const freq of tones) {
    const n = Math.floor(SAMPLE_RATE * toneDuration);
    for (let i = 0; i < n; i++) {
      const t = i / SAMPLE_RATE;
      // Attack/release ramps declick the edges; the slow decay lets the note sustain.
      const attack = i < 120 ? i / 120 : 1;
      const release = i > n - 200 ? (n - i) / 200 : 1;
      const envelope = Math.exp(-3 * t) * attack * release;
      const wave =
        Math.sin(2 * Math.PI * freq * t) + 0.25 * Math.sin(2 * Math.PI * freq * 2 * t);
      const sample = wave * envelope * 0.7;
      const clamped = Math.max(-1, Math.min(1, sample));
      buf.writeInt16LE(Math.round(clamped * 32767), (offset + i) * 2);
    }
    offset += n + Math.floor(SAMPLE_RATE * gap);
  }

  return buf;
}
