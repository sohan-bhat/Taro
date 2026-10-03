/**
 * MeetingBaas v2, called with each workspace's own API key. v2 is the only
 * version that streams live meeting audio, which live commands depend on.
 */

import { COPY, cleanDashes, sentence } from '@taro/shared';
import { env } from '../config/env';
import { log, errorMessage } from '../lib/logger';
import type { KeyCheck } from './llm';

const API = 'https://api.meetingbaas.com/v2';
const TIMEOUT_MS = 20_000;

export class MeetingBaasError extends Error {
  constructor(
    message: string,
    public status?: number
  ) {
    super(message);
    this.name = 'MeetingBaasError';
  }
}

/** Avatar shown in the call; MeetingBaas fetches it server-side, so it must be public https. */
function botImage(): string | undefined {
  if (env.botImageUrl.startsWith('https://')) return env.botImageUrl;
  if (env.apiUrl.startsWith('https://')) return `${env.apiUrl}/taro-bot.jpg`;
  return undefined;
}

function friendlyError(status: number, detail: string): MeetingBaasError {
  if (status === 401 || status === 403) return new MeetingBaasError(COPY.meetingBaasKeyRejected, status);
  if (status === 402 || /credit|token|balance|quota/i.test(detail)) return new MeetingBaasError(COPY.meetingBaasNoCredit, status);
  if (status === 429) return new MeetingBaasError(COPY.meetingBaasRateLimited, status);
  const said = cleanDashes(detail);
  return new MeetingBaasError(`MeetingBaas returned an error (${status}).${said ? ` ${sentence(said)}` : ''}`, status);
}

// Node's own wording ("fetch failed") means nothing to a person, so only a timeout gets a detail.
function unreachable(error: unknown): MeetingBaasError {
  const timedOut = error instanceof Error && (error.name === 'TimeoutError' || error.name === 'AbortError');
  return new MeetingBaasError(COPY.meetingBaasUnreachable(timedOut ? "It didn't answer in time." : undefined));
}

export class MeetingBaasClient {
  constructor(private readonly apiKey: string) {}

  private async call<T>(method: string, path: string, body?: unknown): Promise<T> {
    let res: Response;
    try {
      res = await fetch(`${API}${path}`, {
        method,
        headers: {
          'x-meeting-baas-api-key': this.apiKey,
          ...(body ? { 'Content-Type': 'application/json' } : {}),
        },
        ...(body ? { body: JSON.stringify(body) } : {}),
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
    } catch (error) {
      log.warn(`[MeetingBaas] ${method} ${path.split('?')[0]} failed:`, errorMessage(error));
      throw unreachable(error);
    }
    const text = await res.text();
    if (!res.ok) {
      let detail = text.slice(0, 200);
      try {
        const parsed = JSON.parse(text) as { message?: string; error?: string };
        detail = parsed.message || parsed.error || detail;
      } catch {
        // not JSON
      }
      throw friendlyError(res.status, detail);
    }
    return (text ? JSON.parse(text) : {}) as T;
  }

  /**
   * Sends a bot to the meeting with audio streaming into this server. The
   * per-meeting secret rides in the socket path and as the callback secret,
   * so only MeetingBaas, holding this bot's secret, can feed audio or report
   * results for this meeting.
   */
  async joinMeeting(opts: {
    meetingUrl: string;
    botName: string;
    meetingId: string;
    secret: string;
  }): Promise<{ botId: string }> {
    const streaming = env.apiUrl.startsWith('https://');
    if (!streaming) {
      log.warn('[MeetingBaas] API_URL is not https, so live audio streaming is off for this meeting.');
    }
    const wss = env.apiUrl.replace(/^https:\/\//, 'wss://');
    const image = botImage();

    const data = await this.call<{ success?: boolean; data?: { bot_id?: string } }>('POST', '/bots', {
      meeting_url: opts.meetingUrl,
      bot_name: opts.botName,
      ...(image ? { bot_image: image } : {}),
      entry_message: COPY.meetingChatGreeting(opts.botName),
      recording_mode: 'speaker_view',
      timeout_config: { waiting_room_timeout: 600, no_one_joined_timeout: 300 },
      ...(streaming
        ? {
            streaming_enabled: true,
            streaming_config: {
              input_url: `${wss}/ws/audio-in/${opts.meetingId}/${opts.secret}`,
              output_url: `${wss}/ws/audio-out/${opts.meetingId}/${opts.secret}`,
              audio_frequency: 16000,
            },
          }
        : {}),
      callback_enabled: true,
      callback_config: {
        url: `${env.apiUrl}/api/webhooks/meetingbaas`,
        method: 'POST',
        secret: opts.secret,
      },
      extra: { taroMeetingId: opts.meetingId },
    });

    const botId = data.data?.bot_id;
    if (!botId) throw new MeetingBaasError("MeetingBaas didn't send back a bot ID.");
    return { botId };
  }

  async leave(botId: string): Promise<void> {
    await this.call('POST', `/bots/${encodeURIComponent(botId)}/leave`);
  }

  /** Listing bots is free and answers 401 for a bad key. */
  static async validate(apiKey: string): Promise<KeyCheck> {
    try {
      await new MeetingBaasClient(apiKey).call('GET', '/bots?limit=1');
      return { ok: true };
    } catch (error) {
      // The key dialog is already on the Setup page, so "update it in Setup" would read oddly there.
      const rejected = error instanceof MeetingBaasError && (error.status === 401 || error.status === 403);
      return { ok: false, error: rejected ? 'MeetingBaas rejected this key.' : errorMessage(error) };
    }
  }
}
