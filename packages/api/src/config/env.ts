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
  slackSigningSecret: getOptional('SLACK_SIGNING_SECRET', ''),
  slackAppToken: getOptional('SLACK_APP_TOKEN', ''),

  // Google Gemini (optional — falls back to regex intent parser without it)
  googleApiKey: getOptional('GOOGLE_API_KEY', ''),
  geminiModel: getOptional('GEMINI_MODEL', 'gemini-3.5-flash'),

  // MeetingBaas
  meetingBaasApiKey: getRequired('MEETINGBAAS_API_KEY'),

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
  geminiModel: env.geminiModel,
  port: env.port,
  apiUrl: env.apiUrl,
  isDev: env.isDev,
});
