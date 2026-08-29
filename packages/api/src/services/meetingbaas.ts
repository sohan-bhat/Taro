/**
 * MeetingBaas API service - handles meeting bot deployment via external API.
 * Coded against the v1 API: https://docs.meetingbaas.com
 */

import { env } from '../config/env';

const MEETINGBAAS_API = 'https://api.meetingbaas.com';

interface JoinMeetingParams {
  meetingUrl: string;
  botName?: string;
  webhookUrl: string;
  /** Our meeting ID, used to route the realtime audio WebSockets */
  meetingId?: string;
  /** Public https base URL (converted to wss for streaming endpoints) */
  publicBaseUrl?: string;
  /** Public https URL of the avatar the bot shows in the meeting */
  botImage?: string;
}

/**
 * The avatar the meeting bot shows in Google Meet / Zoom / Teams. MeetingBaas
 * fetches this over the public internet from its own servers, so it must be a
 * reachable https URL (localhost won't work). Order of preference:
 *   1. explicit BOT_IMAGE_URL
 *   2. the API host itself (/taro-bot.jpg), already public and proven
 *      reachable by MeetingBaas since webhooks and the audio stream land here
 *   3. the web app on Vercel (/taro-bot.jpg in its public dir)
 */
function defaultBotImage(): string {
  if (env.botImageUrl.startsWith('https://')) return env.botImageUrl;
  if (env.apiUrl.startsWith('https://')) return `${env.apiUrl.replace(/\/$/, '')}/taro-bot.jpg`;
  if (env.appUrl.startsWith('https://')) return `${env.appUrl.replace(/\/$/, '')}/taro-bot.jpg`;
  return '';
}

interface MeetingBaasBot {
  bot_id: string;
  [key: string]: unknown;
}

export class MeetingBaasService {
  private apiKey: string;

  constructor(apiKey: string) {
    this.apiKey = apiKey;
  }

  async joinMeeting({
    meetingUrl,
    botName = 'Taro Assistant',
    webhookUrl,
    meetingId,
    publicBaseUrl,
    botImage,
  }: JoinMeetingParams): Promise<MeetingBaasBot> {
    console.log(`[MeetingBaas] Joining meeting: ${meetingUrl}`);

    const image = botImage || defaultBotImage();
    if (image) console.log(`[MeetingBaas] Bot avatar: ${image}`);

    const useV2 = env.meetingBaasApiVersion === 'v2';
    const streamOk = meetingId && publicBaseUrl?.startsWith('https://');
    if (meetingId && !streamOk) {
      console.warn(
        `[MeetingBaas] API_URL is not https (${publicBaseUrl}) - realtime streaming disabled, post-meeting fallback only`
      );
    }
    const wssBase = streamOk
      ? publicBaseUrl!.replace(/^https:\/\//, 'wss://').replace(/\/$/, '')
      : '';
    const inUrl = `${wssBase}/ws/audio-in/${meetingId}`;
    const outUrl = `${wssBase}/ws/audio-out/${meetingId}`;

    let url: string;
    let body: Record<string, unknown>;

    if (useV2) {
      // v2 is the API version that actually delivers realtime audio, matching the
      // MeetingBaas reference bot's shape (streaming_config, integer Hz, no transcription).
      url = `${MEETINGBAAS_API}/v2/bots`;
      body = {
        meeting_url: meetingUrl,
        bot_name: botName,
        ...(image ? { bot_image: image } : {}),
        entry_message: 'Taro Assistant has joined - say "Hey Taro, ..." to give me a command',
        recording_mode: 'speaker_view',
        reserved: false,
        ...(streamOk
          ? {
              streaming_enabled: true,
              streaming_config: {
                input_url: inUrl,
                output_url: outUrl,
                audio_frequency: 16000,
              },
            }
          : {}),
        ...(webhookUrl ? { callback_enabled: true, callback_config: { url: webhookUrl } } : {}),
      };
      if (streamOk) console.log(`[MeetingBaas] (v2) Streaming: in=${inUrl} out=${outUrl}`);
    } else {
      // v1 does not deliver streaming audio (confirmed empirically), but is kept
      // so the post-meeting path works without a v2 key.
      url = `${MEETINGBAAS_API}/bots`;
      body = {
        meeting_url: meetingUrl,
        bot_name: botName,
        ...(image ? { bot_image: image } : {}),
        recording_mode: 'speaker_view',
        entry_message: 'Taro Assistant has joined - say "Hey Taro, ..." to give me a command',
        automatic_leave: { waiting_room_timeout: 600, noone_joined_timeout: 600 },
        ...(streamOk
          ? { streaming: { input: inUrl, output: outUrl, audio_frequency: '16khz' } }
          : {}),
        webhook_url: webhookUrl,
      };
    }

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-meeting-baas-api-key': this.apiKey,
      },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const error = await response.text();
      console.error(`[MeetingBaas] Join failed (${env.meetingBaasApiVersion}): ${error}`);
      throw new Error(`MeetingBaas API error: ${response.status} - ${error}`);
    }

    const data = await response.json();
    // v1 returns { bot_id }; v2 returns { data: { bot_id } }
    const botId = data.bot_id ?? data.data?.bot_id;
    console.log(`[MeetingBaas] Bot deployed (${env.meetingBaasApiVersion}): ${botId}`);
    return { ...data, bot_id: botId };
  }

  async leaveBot(botId: string): Promise<void> {
    console.log(`[MeetingBaas] Removing bot: ${botId}`);

    const base = env.meetingBaasApiVersion === 'v2' ? `${MEETINGBAAS_API}/v2` : MEETINGBAAS_API;
    const response = await fetch(`${base}/bots/${botId}`, {
      method: 'DELETE',
      headers: { 'x-meeting-baas-api-key': this.apiKey },
    });

    if (!response.ok) {
      const error = await response.text();
      console.error(`[MeetingBaas] Leave failed: ${error}`);
      throw new Error(`MeetingBaas API error: ${response.status}`);
    }
  }
}

let instance: MeetingBaasService | null = null;

export function getMeetingBaasService(): MeetingBaasService {
  if (!instance) {
    const apiKey = process.env.MEETINGBAAS_API_KEY;
    if (!apiKey) {
      throw new Error('MEETINGBAAS_API_KEY is not set');
    }
    instance = new MeetingBaasService(apiKey);
  }
  return instance;
}
