// Wake word to trigger Taro
export const WAKE_WORD = 'hey taro';

// Common speech-to-text mishearings of the wake word.
// Transcription providers frequently mangle "Taro" — match generously.
export const WAKE_WORD_VARIATIONS = [
  'hey taro',
  'hey tarot',
  'hey tara',
  'hey tarro',
  'hey taru',
  'hey terra',
  'a taro',
  'hey tario',
] as const;

// Maximum words captured after the wake word as a single command
export const MAX_COMMAND_WORDS = 30;

// Supported intents
export const INTENTS = {
  POST_MESSAGE: 'post_message',
  CREATE_TASK: 'create_task',
  UNKNOWN: 'unknown',
} as const;

// Meeting status
export const MEETING_STATUS = {
  PENDING: 'pending',
  JOINING: 'joining',
  ACTIVE: 'active',
  ENDED: 'ended',
  ERROR: 'error',
} as const;

// API endpoints
export const API_ROUTES = {
  HEALTH: '/health',
  COMPANIES: '/api/companies',
  MEETINGS: '/api/meetings',
  SLACK_INSTALL: '/api/slack/install',
  SLACK_CALLBACK: '/api/slack/callback',
} as const;
