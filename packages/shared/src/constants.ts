// Wake word to trigger Taro
export const WAKE_WORD = 'hey taro';

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

// TTS response messages
export const TTS_RESPONSES = {
  COMMAND_RECEIVED: "Got it, let me do that for you.",
  SUCCESS: "Done!",
  CLARIFICATION: "I didn't quite catch that. Could you repeat?",
  ERROR: "Sorry, something went wrong. Please try again.",
  SLACK_SUCCESS: (channel: string) => `Done! I posted your message to ${channel}.`,
  TASK_SUCCESS: (channel: string) => `Done! I created the task in ${channel}.`,
} as const;

// API endpoints
export const API_ROUTES = {
  HEALTH: '/health',
  COMPANIES: '/api/companies',
  MEETINGS: '/api/meetings',
  SLACK_INSTALL: '/api/slack/install',
  SLACK_CALLBACK: '/api/slack/callback',
  SLACK_WEBHOOK: '/api/slack/webhook',
} as const;
