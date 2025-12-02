import { WebClient } from '@slack/web-api';
import { SlackConnectionModel } from '../db/models';

export class SlackService {
  private client: WebClient;
  private companyId: string;

  constructor(accessToken: string, companyId: string) {
    this.client = new WebClient(accessToken);
    this.companyId = companyId;
  }

  // Create SlackService from companyId
  static async fromCompanyId(companyId: string): Promise<SlackService | null> {
    const connection = await SlackConnectionModel.findOne({ companyId });
    if (!connection) {
      return null;
    }
    return new SlackService(connection.accessToken, companyId);
  }

  // Post a message to a channel
  async postMessage(channel: string, text: string): Promise<{ success: boolean; error?: string }> {
    try {
      // Handle channel name with or without #
      const channelName = channel.replace(/^#/, '');

      // First, try to find the channel
      const channelId = await this.findChannelId(channelName);
      if (!channelId) {
        return { success: false, error: `Channel "${channelName}" not found` };
      }

      // Try to join the channel first (in case bot isn't a member)
      try {
        await this.client.conversations.join({ channel: channelId });
      } catch {
        // Ignore join errors - bot might already be a member
      }

      // Post the message
      await this.client.chat.postMessage({
        channel: channelId,
        text,
      });

      return { success: true };
    } catch (error) {
      console.error('Slack postMessage error:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  }

  // Find channel ID by name
  private async findChannelId(channelName: string): Promise<string | null> {
    try {
      // List public channels
      const result = await this.client.conversations.list({
        types: 'public_channel,private_channel',
        limit: 1000,
      });

      const channel = result.channels?.find(
        (ch) => ch.name?.toLowerCase() === channelName.toLowerCase()
      );

      return channel?.id || null;
    } catch (error) {
      console.error('Error finding channel:', error);
      return null;
    }
  }

  // Get list of channels (for UI)
  async getChannels(): Promise<Array<{ id: string; name: string }>> {
    try {
      const result = await this.client.conversations.list({
        types: 'public_channel',
        limit: 200,
      });

      return (
        result.channels?.map((ch) => ({
          id: ch.id!,
          name: ch.name!,
        })) || []
      );
    } catch (error) {
      console.error('Error listing channels:', error);
      return [];
    }
  }
}
