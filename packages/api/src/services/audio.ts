/**
 * Audio utilities for the realtime pipeline.
 * All audio is 16 kHz, 16-bit signed little-endian, mono - the format
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

/**
 * Generate a pleasant two-tone "ding" (A5 then E6) as s16le PCM,
 * with an exponential decay envelope. Played into the meeting via the
 * MeetingBaas output stream when a command completes.
 */
export function makeDingPcm(): Buffer {
  const toneDuration = 0.18; // seconds per tone
  const gap = 0.02;
  const tones = [880, 1318.5];
  const totalSamples = Math.floor(SAMPLE_RATE * (tones.length * (toneDuration + gap)));
  const buf = Buffer.alloc(totalSamples * 2);

  let offset = 0;
  for (const freq of tones) {
    const n = Math.floor(SAMPLE_RATE * toneDuration);
    for (let i = 0; i < n; i++) {
      const t = i / SAMPLE_RATE;
      const envelope = Math.exp(-6 * t) * (i < 80 ? i / 80 : 1); // decay + declick
      const sample = Math.sin(2 * Math.PI * freq * t) * envelope * 0.4;
      buf.writeInt16LE(Math.round(sample * 32767), (offset + i) * 2);
    }
    offset += n + Math.floor(SAMPLE_RATE * gap);
  }

  return buf;
}
