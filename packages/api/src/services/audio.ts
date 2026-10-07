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
