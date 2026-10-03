/**
 * Pure transcript-processing functions: flattening MeetingBaas word arrays,
 * normalizing speech text, and extracting "Hey Taro" commands.
 *
 * Kept side-effect free so they can be unit tested without any live services.
 */

import { findWakeMatches, normalizeSpeech, WAKE_WORD_VARIATIONS } from '@taro/shared';

export { findWakeMatches, normalizeSpeech } from '@taro/shared';

interface TranscriptWord {
  word?: string;
}

export interface TranscriptSegment {
  speaker?: string;
  words?: TranscriptWord[];
}

const MAX_COMMAND_LENGTH = 300;
// Ignores fragments too short to be a real command, e.g. "hey taro" with nothing after it
const MIN_COMMAND_LENGTH = 4;

/**
 * Flatten MeetingBaas `complete` webhook transcript segments into one string.
 * Words are joined with single spaces regardless of whether the provider
 * space-prefixes them (both shapes exist in the wild).
 */
export function flattenTranscript(segments: TranscriptSegment[]): string {
  return segments
    .map((segment) =>
      (segment.words ?? [])
        .map((w) => (w.word ?? '').trim())
        .filter(Boolean)
        .join(' ')
    )
    .filter(Boolean)
    .join(' ');
}

// Returns the command text following each wake phrase, up to the next wake phrase or MAX_COMMAND_LENGTH.
export function extractCommands(
  fullText: string,
  // Kept for signature compatibility; matching is now phonetic, not list-based.
  _wakeWords: readonly string[] = WAKE_WORD_VARIATIONS
): string[] {
  const text = normalizeSpeech(fullText);
  const matches = findWakeMatches(text);

  const commands: string[] = [];
  for (let i = 0; i < matches.length; i++) {
    const sliceEnd = i + 1 < matches.length ? matches[i + 1].start : text.length;
    const command = text
      .slice(matches[i].end, sliceEnd)
      .replace(/^[\s,.!?:;-]+/, '')
      .trim()
      .slice(0, MAX_COMMAND_LENGTH)
      .trim();
    if (command.length >= MIN_COMMAND_LENGTH) {
      commands.push(command);
    }
  }

  return commands;
}
