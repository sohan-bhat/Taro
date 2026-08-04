/**
 * Realtime diagnostics: JSON-lines log plus a short raw-audio capture per
 * meeting, so a failed live test can be analyzed after the fact (what the
 * ASR heard, how much audio arrived, and the exact wire format).
 * Both files are gitignored.
 */
import fs from 'fs';
import path from 'path';

const LOG_PATH = path.resolve(__dirname, '../../realtime-debug.log');

export function debugLog(entry: Record<string, unknown>) {
  const line = `${JSON.stringify({ t: new Date().toISOString(), ...entry })}\n`;
  fs.appendFile(LOG_PATH, line, () => {});
}

// First ~20s of raw audio per meeting (16 kHz s16le mono would be 640 KB)
const CAPTURE_CAP_BYTES = 16000 * 2 * 20;
const captured = new Map<string, number>();

export function captureAudio(meetingId: string, chunk: Buffer) {
  const written = captured.get(meetingId) ?? 0;
  if (written >= CAPTURE_CAP_BYTES) return;
  captured.set(meetingId, written + chunk.length);
  fs.appendFile(path.resolve(__dirname, `../../audio-probe-${meetingId}.raw`), chunk, () => {});
}
