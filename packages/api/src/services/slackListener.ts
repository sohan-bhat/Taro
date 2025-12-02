import { SocketModeClient } from '@slack/socket-mode';
import { WebClient } from '@slack/web-api';
import { SlackConnectionModel, MeetingModel } from '../db/models';
import { getMeetingBaasService } from './meetingbaas';
import { env } from '../config/env';

const MEET_LINK_REGEX = /https:\/\/meet\.google\.com\/[a-z]{3}-[a-z]{4}-[a-z]{3}/gi;

export class SlackListener {
  private socketClient: SocketModeClient | null = null;
  private started = false;

  async start() {
    const appToken = process.env.SLACK_APP_TOKEN;

    if (!appToken) {
      console.log('Slack listener: No SLACK_APP_TOKEN, skipping auto-join feature');
      return;
    }

    if (this.started) return;

    try {
      this.socketClient = new SocketModeClient({ appToken });

      // Listen for all events and log them for debugging
      this.socketClient.on('slack_event', async ({ event, body, ack }) => {
        await ack();
        console.log('Slack listener: Received event type:', event?.type);

        if (event?.type === 'message' && !event.subtype) {
          await this.handleMessage(event);
        }
      });

      // Also listen for message events directly
      this.socketClient.on('message', async ({ event, ack }) => {
        await ack();
        console.log('Slack listener: Received message event');
        await this.handleMessage(event);
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
        status: { $in: ['pending', 'joining', 'active'] }
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

        console.log(`Slack listener: Bot deployed: ${bot.bot_id}`);
      } catch (error) {
        console.error('Slack listener: Failed to deploy bot:', error);
        meeting.status = 'error';
        await meeting.save();
      }

      // Post confirmation in Slack
      const webClient = new WebClient(connection.accessToken);
      await webClient.chat.postMessage({
        channel: event.channel,
        text: `Joining the meeting...`,
        thread_ts: event.ts,
      });

    } catch (error) {
      console.error('Slack listener: Error handling Meet link', error);
    }
  }

  stop() {
    if (this.socketClient) {
      this.socketClient.disconnect();
      this.started = false;
    }
  }
}

export const slackListener = new SlackListener();
