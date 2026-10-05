// Imported first by index.ts so a missing variable fails fast, before anything else loads.
// Provider keys (MeetingBaas, AI models, transcription) are NOT server settings:
// every workspace brings its own and they live encrypted in the database.

import fs from 'fs';
import path from 'path';
import dotenv from 'dotenv';

// Find the nearest .env walking up from the working directory, so `pnpm dev`
// in packages/api, the built bundle, and the repo root all pick up the same file.
// In Docker and on hosting platforms there is no file and the real env wins.
(function loadDotenv() {
  let dir = process.cwd();
  for (let i = 0; i < 4; i++) {
    const candidate = path.join(dir, '.env');
    if (fs.existsSync(candidate)) {
      dotenv.config({ path: candidate });
      return;
    }
    const parent = path.dirname(dir);
    if (parent === dir) return;
    dir = parent;
  }
})();

const isProduction = process.env.NODE_ENV === 'production';

function required(key: string, hint?: string): string {
  const value = process.env[key];
  if (!value) {
    throw new Error(`Missing required environment variable: ${key}${hint ? `\n  ${hint}` : ''}`);
  }
  return value;
}

function optional(key: string, fallback = ''): string {
  return process.env[key] || fallback;
}

/** PEM as-is, PEM with literal \n, or base64 of the PEM file */
function decodePrivateKey(raw: string): string {
  if (!raw) return '';
  if (raw.includes('BEGIN')) return raw.replace(/\\n/g, '\n');
  return Buffer.from(raw, 'base64').toString('utf8');
}

/** 32+ random bytes, given as base64 or hex. */
function decodeEncryptionKey(raw: string): Buffer {
  const trimmed = raw.trim();
  const buf = /^[0-9a-f]+$/i.test(trimmed) && trimmed.length >= 64
    ? Buffer.from(trimmed, 'hex')
    : Buffer.from(trimmed, 'base64');
  if (buf.length < 32) {
    throw new Error(
      'ENCRYPTION_KEY must be at least 32 random bytes (base64 or hex).\n  Generate one with: openssl rand -base64 32'
    );
  }
  return buf;
}

function list(raw: string): string[] {
  return raw
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

const apiUrl = optional('API_URL', 'http://localhost:4000').replace(/\/$/, '');
const appUrl = optional('APP_URL', optional('NEXT_PUBLIC_APP_URL', 'http://localhost:3000')).replace(/\/$/, '');

export const env = {
  isDev: !isProduction,
  isProduction,
  port: Number(optional('PORT', '4000')),

  mongoUri: required('MONGODB_URI'),
  // Encrypts every stored API key and signs OAuth state. Losing it makes stored keys unreadable.
  encryptionKey: decodeEncryptionKey(
    required('ENCRYPTION_KEY', 'Generate one with: openssl rand -base64 32')
  ),

  // Public URL of this API (OAuth callbacks, MeetingBaas webhooks and audio streams land here).
  apiUrl,
  // The dashboard; OAuth flows return here. WEB_ORIGINS lists extra trusted dashboard origins.
  appUrl,
  webOrigins: list(optional('WEB_ORIGINS')),
  // IDs of the Taro browser extension builds allowed to call the API (unpacked, Chrome Web Store, Edge).
  extensionIds: list(optional('EXTENSION_IDS')).filter((id) => /^[a-p]{32}$/.test(id)),

  slackClientId: optional('SLACK_CLIENT_ID'),
  slackClientSecret: optional('SLACK_CLIENT_SECRET'),
  // Socket Mode token (xapp-...); without it Taro can't see meeting links posted in Slack.
  slackAppToken: optional('SLACK_APP_TOKEN'),

  // Sign in with Google, and Connect Google Calendar on the same client. Optional: both are offered
  // once its client ID and secret are set.
  googleClientId: optional('GOOGLE_CLIENT_ID'),
  googleClientSecret: optional('GOOGLE_CLIENT_SECRET'),

  // Taro's bot identity on GitHub. Optional: without it the GitHub integration is hidden.
  githubAppId: optional('GITHUB_APP_ID'),
  githubAppSlug: optional('GITHUB_APP_SLUG'),
  githubAppPrivateKey: decodePrivateKey(optional('GITHUB_APP_PRIVATE_KEY')),
  // Used to confirm the person connecting an installation actually has access to it.
  githubAppClientId: optional('GITHUB_APP_CLIENT_ID'),
  githubAppClientSecret: optional('GITHUB_APP_CLIENT_SECRET'),

  // Calendar invitations. Optional: each workspace's Taro address is INVITE_ADDRESS with {token}
  // replaced, and the mail provider posts invitations to the webhook with INBOUND_SECRET.
  inviteAddress: optional('INVITE_ADDRESS'),
  inboundSecret: optional('INBOUND_SECRET'),

  // Optional transcription the operator hosts for every workspace (no per-workspace key):
  // a faster-whisper server, or the in-process sherpa-onnx model when LOCAL_ASR=1.
  sttWsUrl: optional('STT_WS_URL'),
  localAsr: optional('LOCAL_ASR') === '1',

  // Must be a public https URL MeetingBaas can fetch; defaults to the logo served by this API.
  botImageUrl: optional('BOT_IMAGE_URL'),
  defaultBotName: optional('BOT_NAME', 'Taro'),

  // Guards a workspace's own MeetingBaas bill against a runaway loop of meeting links.
  maxActiveMeetingsPerWorkspace: Number(optional('MAX_ACTIVE_MEETINGS_PER_WORKSPACE', '5')),
  // How many proxies sit in front of the API (1 on Render, Railway, Fly). Rate limits key on
  // the client IP these proxies report, so too high a number lets clients spoof it.
  trustProxyHops: Number(optional('TRUST_PROXY_HOPS', '1')),

  // Writes a JSONL trace and the first seconds of raw audio per meeting to disk. Debugging only.
  realtimeDebug: optional('REALTIME_DEBUG') === '1',
} as const;

export function githubAppConfigured(): boolean {
  return !!(env.githubAppId && env.githubAppSlug && env.githubAppPrivateKey);
}

// Installation ownership checks need the app's OAuth client credentials.
export function githubOAuthConfigured(): boolean {
  return !!(env.githubAppClientId && env.githubAppClientSecret);
}

/** The Slack app: Sign in with Slack and adding Taro to Slack both need it. */
export function slackConfigured(): boolean {
  return !!(env.slackClientId && env.slackClientSecret);
}

export function googleSignInConfigured(): boolean {
  return !!(env.googleClientId && env.googleClientSecret);
}

/** Each member can connect their own Google Calendar through the sign-in client. */
export function googleCalendarConfigured(): boolean {
  return googleSignInConfigured();
}

export function serverSttAvailable(): boolean {
  return !!env.sttWsUrl || env.localAsr;
}

if (!slackConfigured() && !googleSignInConfigured()) {
  throw new Error(
    'No way to sign in is set up. Set SLACK_CLIENT_ID and SLACK_CLIENT_SECRET, or GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET.'
  );
}

if (isProduction && (!apiUrl.startsWith('https://') || !appUrl.startsWith('https://'))) {
  console.warn('[Config] API_URL and APP_URL should be https in production.');
}

console.log('[Config] Environment loaded:', {
  mode: isProduction ? 'production' : 'development',
  apiUrl,
  appUrl,
  webOrigins: env.webOrigins,
  slackSocketMode: !!env.slackAppToken,
  signIn: [slackConfigured() && 'slack', googleSignInConfigured() && 'google'].filter(Boolean),
  githubApp: githubAppConfigured(),
  githubInstallVerification: githubOAuthConfigured(),
  calendarInvites: !!(env.inviteAddress && env.inboundSecret),
  googleCalendar: googleCalendarConfigured(),
  serverStt: env.sttWsUrl ? 'faster-whisper server' : env.localAsr ? 'local sherpa-onnx' : 'none',
});
