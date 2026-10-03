/**
 * Realtime diagnostics, off unless REALTIME_DEBUG=1: a JSON-lines trace of
 * sockets, utterances, and commands, so a failed live test can be analyzed
 * afterwards. It contains meeting text, so never enable it on a shared server.
 * The file lands in the working directory and is gitignored. Audio is never
 * written anywhere.
 */
import fs from 'fs';
import path from 'path';
import { env } from '../config/env';

const LOG_PATH = path.resolve(process.cwd(), 'realtime-debug.log');

export function debugLog(entry: Record<string, unknown>) {
  if (!env.realtimeDebug) return;
  const line = `${JSON.stringify({ t: new Date().toISOString(), ...entry })}\n`;
  fs.appendFile(LOG_PATH, line, () => {});
}
