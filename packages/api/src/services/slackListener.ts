import { SocketModeClient } from '@slack/socket-mode';
import { WebClient } from '@slack/web-api';
import { COPY, MEETING_PLATFORMS } from '@taro/shared';
import { SlackConnectionModel, UserModel } from '../db/models';
import { env } from '../config/env';
import { findMeetingLinks } from '../lib/meetingUrl';
import { log, errorMessage } from '../lib/logger';
import { readSlackToken } from './slack';
import { launchMeeting, LaunchError } from './meetingLauncher';

const CHANNEL_NAME_WAIT_MS = 3000;

/**
 * Watches every Slack workspace Taro is installed in (one Socket Mode
 * connection covers them all) for Google Meet, Zoom, and Teams links, and
 * sends the bot in with that workspace's own MeetingBaas key.
 */
export class SlackListener {
  private socketClient: SocketModeClient | null = null;
  private started = false;

  async start() {
    if (!env.slackAppToken || this.started) return;

    try {
      this.socketClient = new SocketModeClient({ appToken: env.slackAppToken });

      // EventEmitter doesn't await async listeners, so an uncaught rejection here
      // (an ack() during a socket refresh, say) would otherwise crash the process.
      this.socketClient.on('message', async ({ event, body, ack }) => {
        try {
          await ack();
          await this.handleMessage(event, body);
        } catch (error) {
          log.error('[Slack] Event handling error:', errorMessage(error));
        }
      });

      await this.socketClient.start();
      this.started = true;
      log.info('[Slack] Listening for meeting links via Socket Mode');
    } catch (error) {
      log.error('[Slack] Socket Mode failed to start:', errorMessage(error));
    }
  }

  private async handleMessage(event: any, body: any) {
    // Ignore bots (including Taro itself) and anything without text; edits carry
    // their text under event.message, so they're skipped here too.
    if (!event?.text || event.bot_id) return;

    const links = findMeetingLinks(event.text);
    if (links.length === 0) return;
    const link = links[0];

    // The installation that received the event, not the poster's team: in a channel
    // shared with another organization (Slack Connect) those differ.
    const teamId: unknown = body?.authorizations?.[0]?.team_id || body?.team_id;
    if (typeof teamId !== 'string' || !teamId) return;
    // People from the other side of a shared channel can't spend this workspace's credits.
    if (body?.is_ext_shared_channel && typeof event.team === 'string' && event.team !== teamId) {
      log.debug(`[Slack] Ignoring a meeting link posted from outside team ${teamId}`);
      return;
    }
    const connection = await SlackConnectionModel.findOne({ teamId });
    if (!connection) {
      log.debug(`[Slack] Meeting link in team ${teamId}, which has no Taro workspace`);
      return;
    }

    const web = new WebClient(readSlackToken(connection));
    const reply = (text: string) =>
      web.chat.postMessage({ channel: event.channel, text, thread_ts: event.ts }).catch((error) => {
        log.warn('[Slack] Thread reply failed:', errorMessage(error));
      });

    // Each launch spends the workspace's own MeetingBaas credits, so only a full
    // member may trigger one: not a guest, not deactivated, not removed from Taro.
    if (typeof event.user !== 'string' || !event.user) return;
    // Looked up alongside the checks below, for "Priya, from #product". The Slack client retries for
    // minutes when Slack is slow, so a launch waits a moment for the name at most.
    const channelName: Promise<string | undefined> = Promise.race([
      web.conversations.info({ channel: event.channel }).then(
        (r) => r.channel?.name || undefined,
        () => undefined
      ),
      new Promise<undefined>((resolve) => setTimeout(resolve, CHANNEL_NAME_WAIT_MS)),
    ]);
    let poster;
    try {
      poster = (await web.users.info({ user: event.user })).user;
    } catch (error) {
      log.warn('[Slack] Could not look up who posted a meeting link:', errorMessage(error));
      await reply(`I couldn't check who posted this link, so I didn't join. Try posting it again in a moment.`);
      return;
    }
    if (!poster || poster.deleted || poster.is_bot) return;
    if (poster.is_restricted || poster.is_ultra_restricted) {
      await reply('Only full members of this Slack workspace can send me to a meeting.');
      return;
    }
    const member = await UserModel.findOne({ slackTeamId: teamId, slackUserId: event.user }).select('_id removedAt');
    if (member?.removedAt) {
      await reply("You were removed from this Taro workspace, so I can't join meetings for you. Ask an owner to restore you.");
      return;
    }
    const startedByName = poster.profile?.display_name || poster.real_name || poster.name || undefined;

    try {
      const { alreadyActive } = await launchMeeting({
        companyId: connection.companyId,
        link,
        source: 'slack',
        slackChannelId: event.channel,
        slackChannelName: await channelName,
        slackThreadTs: event.ts,
        startedByName,
        startedByUserId: member?._id.toString(),
        startedBySlackUserId: event.user,
      });
      await reply(alreadyActive ? COPY.slackAlreadyIn : COPY.slackJoinReply(MEETING_PLATFORMS[link.platform]));
    } catch (error) {
      if (error instanceof LaunchError) {
        const finish = error.code === 'not_ready' ? ` ${COPY.slackFinishSetup(`${env.appUrl}/dashboard?view=setup`)}` : '';
        await reply(`${COPY.slackCouldntJoin(error.message)}${finish}`);
        return;
      }
      log.error('[Slack] Launch failed:', errorMessage(error));
      await reply(COPY.slackSomethingWrong);
    }
  }

  stop() {
    if (this.socketClient) {
      this.socketClient.disconnect().catch(() => {});
      this.started = false;
    }
  }
}

export const slackListener = new SlackListener();
