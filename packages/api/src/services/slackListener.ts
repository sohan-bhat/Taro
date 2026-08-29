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

      // Socket Mode re-emits events_api envelopes under the inner event type.
      // EventEmitter doesn't await async listeners, so an uncaught rejection
      // here (e.g. ack() during a socket refresh) would crash the process.
      this.socketClient.on('message', async ({ event, body, ack }) => {
        try {
          await ack();
          await this.handleMessage(event, body);
        } catch (error) {
          console.error('Slack listener: Event handling error', error);
        }
      });

      await this.socketClient.start();
      this.started = true;
      console.log('Slack listener: Connected to Slack via Socket Mode');
    } catch (error) {
      console.error('Slack listener: Failed to start', error);
    }
  }

  private async handleMessage(event: any, body: any) {
    // Ignore bot messages (including our own) and non-text events
    if (!event?.text || event.bot_id) return;

    const meetLinks = event.text.match(MEET_LINK_REGEX);
    if (!meetLinks || meetLinks.length === 0) return;

    const meetUrl = meetLinks[0];
    console.log(`Slack listener: Detected Meet link: ${meetUrl}`);

    try {
      // event.team can be missing on some message shapes; body.team_id is
      // the authoritative workspace ID.
      const teamId = event.team || body?.team_id;
      const connection = await SlackConnectionModel.findOne({ teamId });
      if (!connection) {
        console.log(`Slack listener: No company found for Slack team ${teamId}`);
        return;
      }

      // A meeting that never got a terminal webhook (server down, tunnel
      // dropped) would otherwise block this URL forever, and personal Meet
      // rooms get reused constantly.
      const existing = await MeetingModel.findOne({
        meetUrl,
        status: { $in: ['pending', 'joining', 'active'] },
      });

      if (existing) {
        const STALE_MS = 3 * 60 * 60 * 1000; // 3 hours
        const age = Date.now() - new Date(existing.createdAt).getTime();

        if (age < STALE_MS) {
          console.log('Slack listener: Meeting already exists');
          const webClient = new WebClient(connection.accessToken);
          await webClient.chat.postMessage({
            channel: event.channel,
            text: `🤖 I'm already in (or joining) this meeting.`,
            thread_ts: event.ts,
          });
          return;
        }

        console.log('Slack listener: Reclaiming stale meeting record');
        await MeetingModel.findByIdAndUpdate(existing._id, { status: 'error' });
      }

      const webClient = new WebClient(connection.accessToken);

      // Resolve who posted the link, for the meeting history
      let startedByName: string | undefined;
      if (event.user) {
        try {
          const info = await webClient.users.info({ user: event.user });
          startedByName =
            info.user?.profile?.display_name ||
            info.user?.real_name ||
            info.user?.name ||
            undefined;
        } catch {
          // users:read may be unavailable; leave the name blank
        }
      }

      // Create meeting, remembering where the link was posted so results
      // can be threaded back after the meeting
      const meeting = await MeetingModel.create({
        companyId: connection.companyId,
        meetUrl,
        status: 'pending',
        slackChannelId: event.channel,
        slackThreadTs: event.ts,
        startedByUserId: event.user,
        startedByName,
      });

      try {
        const meetingBaas = getMeetingBaasService();
        const webhookUrl = `${env.apiUrl}/api/webhooks/meetingbaas`;

        console.log(`Slack listener: Deploying bot to ${meetUrl}`);

        const bot = await meetingBaas.joinMeeting({
          meetingUrl: meetUrl,
          botName: 'Taro Assistant',
          webhookUrl,
          meetingId: meeting._id.toString(),
          publicBaseUrl: env.apiUrl,
        });

        meeting.botId = bot.bot_id;
        meeting.status = 'joining';
        await meeting.save();

        console.log(`Slack listener: Bot deployed: ${bot.bot_id}`);

        await webClient.chat.postMessage({
          channel: event.channel,
          text: `🤖 Taro is joining the meeting. Once I'm in, say *"Hey Taro, ..."* and I'll do it right away, mid-meeting. (You may need to admit me from the lobby.)`,
          thread_ts: event.ts,
        });
      } catch (error) {
        console.error('Slack listener: Failed to deploy bot:', error);
        meeting.status = 'error';
        await meeting.save();

        await webClient.chat.postMessage({
          channel: event.channel,
          text: `⚠️ Taro couldn't join this meeting. Check the API server logs.`,
          thread_ts: event.ts,
        });
      }
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
