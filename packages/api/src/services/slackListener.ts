import { SocketModeClient } from '@slack/socket-mode';
import { WebClient } from '@slack/web-api';
import { SlackConnectionModel, MeetingModel } from '../db/models';
import { getMeetingBaasService } from './meetingbaas';
import { env } from '../config/env';

const MEET_LINK_REGEX = /https:\/\/meet\.google\.com\/[a-z]{3}-[a-z]{4}-[a-z]{3}/gi;

// Cap on the processed-event dedup set before it gets pruned
const MAX_PROCESSED_EVENTS = 500;

export class SlackListener {
  private socketClient: SocketModeClient | null = null;
  private started = false;
  // Slack can redeliver events (and SocketModeClient fires multiple hooks for
  // the same envelope) — track processed message keys to handle each once.
  private processedEvents = new Set<string>();

  async start() {
    const appToken = env.slackAppToken;

    if (!appToken) {
      console.log('Slack listener: No SLACK_APP_TOKEN, skipping auto-join feature');
      return;
    }

    if (this.started) return;

    try {
      this.socketClient = new SocketModeClient({ appToken });

      // Single handler: 'slack_event' fires for every event envelope.
      // Do NOT also subscribe to the named 'message' event — that would
      // process every message twice and deploy duplicate bots.
      this.socketClient.on('slack_event', async ({ event, ack }) => {
        await ack();

        if (event?.type === 'message' && !event.subtype) {
          await this.handleMessage(event);
        }
      });

      await this.socketClient.start();
      this.started = true;
      console.log('Slack listener: Connected to Slack via Socket Mode');
    } catch (error) {
      console.error('Slack listener: Failed to start', error);
    }
  }

  private async handleMessage(event: any) {
    if (!event.text || event.bot_id) return;

    // Dedup by channel + message timestamp (unique per Slack message)
    const eventKey = `${event.channel}:${event.ts}`;
    if (this.processedEvents.has(eventKey)) {
      console.log(`Slack listener: Skipping duplicate event ${eventKey}`);
      return;
    }
    this.processedEvents.add(eventKey);
    this.pruneProcessedEvents();

    const meetLinks = event.text.match(MEET_LINK_REGEX);
    if (!meetLinks || meetLinks.length === 0) return;

    const meetUrl = meetLinks[0];
    console.log(`Slack listener: Detected Meet link: ${meetUrl}`);

    try {
      // Find which company this Slack team belongs to
      const connection = await SlackConnectionModel.findOne({ teamId: event.team });
      if (!connection) {
        console.log('Slack listener: No company found for this Slack team');
        return;
      }

      // Check if we already have this meeting
      const existing = await MeetingModel.findOne({
        meetUrl,
        status: { $in: ['pending', 'joining', 'active'] },
      });

      if (existing) {
        console.log('Slack listener: Meeting already exists');
        return;
      }

      // Create meeting
      const meeting = await MeetingModel.create({
        companyId: connection.companyId,
        meetUrl,
        status: 'pending',
      });

      // Deploy bot via MeetingBaas
      let deployed = false;
      try {
        const meetingBaas = getMeetingBaasService();
        const webhookUrl = `${env.apiUrl}/api/webhooks/meetingbaas`;

        console.log(`Slack listener: Deploying bot to ${meetUrl}`);

        const bot = await meetingBaas.joinMeeting({
          meetingUrl: meetUrl,
          botName: 'Taro Assistant',
          webhookUrl,
        });

        meeting.botId = bot.bot_id;
        meeting.status = 'joining';
        await meeting.save();
        deployed = true;

        console.log(`Slack listener: Bot deployed: ${bot.bot_id}`);
      } catch (error) {
        console.error('Slack listener: Failed to deploy bot:', error);
        meeting.status = 'error';
        await meeting.save();
      }

      // Post an honest confirmation in the thread
      const webClient = new WebClient(connection.accessToken);
      await webClient.chat.postMessage({
        channel: event.channel,
        text: deployed
          ? `:wave: Taro is joining the meeting. Say "Hey Taro, post <message> to #<channel>" during the call.`
          : `:warning: Taro couldn't join the meeting. Check the dashboard for details.`,
        thread_ts: event.ts,
      });
    } catch (error) {
      console.error('Slack listener: Error handling Meet link', error);
    }
  }

  private pruneProcessedEvents() {
    if (this.processedEvents.size <= MAX_PROCESSED_EVENTS) return;
    // Set preserves insertion order — drop the oldest half
    const keys = [...this.processedEvents].slice(0, MAX_PROCESSED_EVENTS / 2);
    for (const key of keys) this.processedEvents.delete(key);
  }

  stop() {
    if (this.socketClient) {
      this.socketClient.disconnect();
      this.started = false;
    }
  }
}

export const slackListener = new SlackListener();
