/**
 * MeetingBaas API service - handles meeting bot deployment via external API.
 * https://docs.meetingbaas.com
 */

const MEETINGBAAS_API = 'https://api.meetingbaas.com';

interface JoinMeetingParams {
  meetingUrl: string;
  botName?: string;
  webhookUrl: string;
}

interface MeetingBaasBot {
  bot_id: string;
  status: string;
  [key: string]: unknown;
}

export class MeetingBaasService {
  private apiKey: string;

  constructor(apiKey: string) {
    this.apiKey = apiKey;
  }

  /**
   * Deploy a bot to join a meeting
   */
  async joinMeeting({ meetingUrl, botName = 'Taro Assistant', webhookUrl }: JoinMeetingParams): Promise<MeetingBaasBot> {
    console.log(`[MeetingBaas] Joining meeting: ${meetingUrl}`);

    const response = await fetch(`${MEETINGBAAS_API}/bots`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-meeting-baas-api-key': this.apiKey,
      },
      body: JSON.stringify({
        meeting_url: meetingUrl,
        bot_name: botName,
        recording_mode: 'speaker_view',
        bot_image: null,
        entry_message: 'Taro Assistant has joined',
        reserved: false,
        speech_to_text: {
          provider: 'Default',
        },
        automatic_leave: {
          waiting_room_timeout: 600,
          noone_joined_timeout: 600,
        },
        webhook_url: webhookUrl,
      }),
    });

    if (!response.ok) {
      const error = await response.text();
      console.error(`[MeetingBaas] Join failed: ${error}`);
      throw new Error(`MeetingBaas API error: ${response.status} - ${error}`);
    }

    const data = await response.json();
    console.log(`[MeetingBaas] Bot deployed: ${data.bot_id}`);
    return data;
  }

  /**
   * Get bot status
   */
  async getBotStatus(botId: string): Promise<MeetingBaasBot> {
    const response = await fetch(`${MEETINGBAAS_API}/bots/${botId}`, {
      headers: { 'x-meeting-baas-api-key': this.apiKey },
    });

    if (!response.ok) {
      throw new Error(`MeetingBaas API error: ${response.status}`);
    }

    return response.json();
  }

  /**
   * Remove bot from meeting
   */
  async leaveBot(botId: string): Promise<void> {
    console.log(`[MeetingBaas] Removing bot: ${botId}`);

    const response = await fetch(`${MEETINGBAAS_API}/bots/${botId}`, {
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

// Singleton instance (created lazily with API key from env)
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
