/**
 * Environment configuration with validation.
 * Import this at the very top of index.ts to fail fast on missing vars.
 */

function getRequired(key: string): string {
  const value = process.env[key];
  if (!value) {
    throw new Error(`Missing required environment variable: ${key}`);
  }
  return value;
}

function getOptional(key: string, defaultValue: string): string {
  return process.env[key] || defaultValue;
}

/** PEM as-is, PEM with literal \\n, or base64 of the PEM file */
function decodePrivateKey(raw: string): string {
  if (!raw) return '';
  if (raw.includes('BEGIN')) return raw.replace(/\\n/g, '\n');
  return Buffer.from(raw, 'base64').toString('utf8');
}

// Load dotenv before validation
import dotenv from 'dotenv';
import path from 'path';
dotenv.config({ path: path.resolve(__dirname, '../../../../.env') });

// Validate and export all environment variables
export const env = {
  // Database
  mongoUri: getRequired('MONGODB_URI'),

  // Slack
  slackClientId: getRequired('SLACK_CLIENT_ID'),
  slackClientSecret: getRequired('SLACK_CLIENT_SECRET'),
  slackAppToken: getOptional('SLACK_APP_TOKEN', ''),

  // Google Gemini (intent parsing)
  googleApiKey: getRequired('GOOGLE_API_KEY'),
  geminiModel: getOptional('GEMINI_MODEL', 'gemini-3.6-flash'),

  // MeetingBaas
  meetingBaasApiKey: getRequired('MEETINGBAAS_API_KEY'),
  // 'v1' (default) or 'v2'. v2 is required for realtime audio streaming and
  // needs a v2-platform API key from MeetingBaas.
  meetingBaasApiVersion: getOptional('MEETINGBAAS_API_VERSION', 'v1'),

  // Realtime transcription backend (first match wins):
  //   GROQ_API_KEY  -> Groq Whisper cloud (scalable, free tier)
  //   STT_WS_URL    -> local faster-whisper server (packages/api/stt-server)
  //   neither       -> in-process sherpa-onnx (free, lower accuracy)
  groqApiKey: getOptional('GROQ_API_KEY', ''),
  sttWsUrl: getOptional('STT_WS_URL', ''),

  // GitHub App: the Taro bot identity for the GitHub connector
  githubAppId: getOptional('GITHUB_APP_ID', ''),
  githubAppSlug: getOptional('GITHUB_APP_SLUG', ''),
  githubAppPrivateKey: decodePrivateKey(getOptional('GITHUB_APP_PRIVATE_KEY', '')),

  // Server
  port: getOptional('PORT', '4000'),
  apiUrl: getOptional('API_URL', 'http://localhost:4000'),
  appUrl: getOptional('NEXT_PUBLIC_APP_URL', 'http://localhost:3000'),

  // Feature flags
  isDev: process.env.NODE_ENV !== 'production',
} as const;

// Log loaded config (without secrets)
console.log('Environment loaded:', {
  mongoUri: env.mongoUri.replace(/\/\/.*@/, '//<credentials>@'),
  slackClientId: env.slackClientId,
  hasSlackAppToken: !!env.slackAppToken,
  hasGoogleApiKey: !!env.googleApiKey,
  hasGithubApp: !!(env.githubAppId && env.githubAppSlug && env.githubAppPrivateKey),
  hasGroqStt: !!env.groqApiKey,
  sttWsUrl: env.sttWsUrl || '(local sherpa-onnx)',
  port: env.port,
  apiUrl: env.apiUrl,
  isDev: env.isDev,
});
