// Leveled console logging. Meeting content (utterances, commands) is logged at
// debug, which production leaves off, so transcripts don't end up in log
// pipelines by default.

type Level = 'debug' | 'info' | 'warn' | 'error';
const ORDER: Record<Level, number> = { debug: 10, info: 20, warn: 30, error: 40 };

function threshold(): number {
  const configured = (process.env.LOG_LEVEL || '').toLowerCase() as Level;
  if (configured in ORDER) return ORDER[configured];
  return process.env.NODE_ENV === 'production' ? ORDER.info : ORDER.debug;
}

const min = threshold();

export const log = {
  debug: (...args: unknown[]) => {
    if (min <= ORDER.debug) console.log(...args);
  },
  info: (...args: unknown[]) => {
    if (min <= ORDER.info) console.log(...args);
  },
  warn: (...args: unknown[]) => {
    if (min <= ORDER.warn) console.warn(...args);
  },
  error: (...args: unknown[]) => {
    console.error(...args);
  },
};

export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
