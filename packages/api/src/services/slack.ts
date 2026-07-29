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

      // First, try to find the channel (fuzzy: "socials" resolves to "social")
      const channelId = await this.findChannelId(channelName);
      if (!channelId) {
        const available = await this.listChannelNames();
        const hint = available.length
          ? ` Available channels: ${available.map((n) => `#${n}`).join(', ')}`
          : '';
        return { success: false, error: `Channel "${channelName}" not found.${hint}` };
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

  // Join every public channel so message.channels events are delivered
  // (Slack only sends channel messages to apps that are members).
  // Called once after OAuth install.
  async joinAllPublicChannels(): Promise<number> {
    try {
      const result = await this.client.conversations.list({
        types: 'public_channel',
        exclude_archived: true,
        limit: 200,
      });

      let joined = 0;
      for (const ch of result.channels ?? []) {
        if (!ch.id || ch.is_member) continue;
        try {
          await this.client.conversations.join({ channel: ch.id });
          joined++;
        } catch (error) {
          console.error(`Slack: could not join #${ch.name}:`, error);
        }
      }
      return joined;
    } catch (error) {
      console.error('Slack joinAllPublicChannels error:', error);
      return 0;
    }
  }

  // Post directly to a known channel ID, optionally threaded
  async postToChannelId(
    channelId: string,
    text: string,
    threadTs?: string
  ): Promise<{ success: boolean; error?: string }> {
    try {
      await this.client.chat.postMessage({
        channel: channelId,
        text,
        ...(threadTs ? { thread_ts: threadTs } : {}),
      });
      return { success: true };
    } catch (error) {
      console.error('Slack postToChannelId error:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  }

  // Find channel ID by name, tolerating ASR/phrasing drift ("socials" -> "social").
  // Public channels only - requesting private_channel without the groups:read
  // scope makes Slack reject the entire call with missing_scope.
  private async findChannelId(channelName: string): Promise<string | null> {
    const match = await this.resolveChannel(channelName);
    return match?.id || null;
  }

  // Resolve a spoken channel name to a real channel. Returns the match plus
  // how confident we are, and the list of available names for a helpful error.
  async resolveChannel(
    channelName: string
  ): Promise<{ id: string; name: string; exact: boolean } | null> {
    try {
      const result = await this.client.conversations.list({
        types: 'public_channel',
        exclude_archived: true,
        limit: 1000,
      });

      const channels = (result.channels ?? [])
        .filter((ch): ch is { id: string; name: string } => !!ch.id && !!ch.name)
        .map((ch) => ({ id: ch.id, name: ch.name }));

      const target = normalizeChannel(channelName);

      // 1. Exact match (after normalization: lowercased, spaces/underscores -> hyphens)
      const exact = channels.find((ch) => normalizeChannel(ch.name) === target);
      if (exact) return { ...exact, exact: true };

      // 2. Closest fuzzy match: singular/plural and small typos collapse.
      //    Threshold scales with name length so short names stay strict.
      let best: { id: string; name: string } | null = null;
      let bestDistance = Infinity;
      for (const ch of channels) {
        const distance = channelDistance(target, normalizeChannel(ch.name));
        if (distance < bestDistance) {
          bestDistance = distance;
          best = ch;
        }
      }

      const tolerance = Math.max(1, Math.floor(target.length / 4));
      if (best && bestDistance <= tolerance) {
        console.log(
          `[Slack] Channel "${channelName}" not exact; using closest match "#${best.name}" (distance ${bestDistance})`
        );
        return { ...best, exact: false };
      }

      return null;
    } catch (error) {
      console.error('Error finding channel:', error);
      return null;
    }
  }

  // Public channel names, for building a helpful "did you mean" style error.
  async listChannelNames(): Promise<string[]> {
    try {
      const result = await this.client.conversations.list({
        types: 'public_channel',
        exclude_archived: true,
        limit: 1000,
      });
      return (result.channels ?? []).map((ch) => ch.name).filter((n): n is string => !!n);
    } catch {
      return [];
    }
  }
}

// Slack channel names are lowercase, hyphenated, no spaces/underscores.
export function normalizeChannel(name: string): string {
  return name
    .toLowerCase()
    .trim()
    .replace(/^#/, '')
    .replace(/[\s_]+/g, '-')
    .replace(/[^a-z0-9-]/g, '');
}

// Levenshtein distance, but a trailing plural "s" (social/socials) and simple
// hyphen differences cost nothing, so obvious spoken variants resolve cleanly.
export function channelDistance(a: string, b: string): number {
  const strip = (s: string) => s.replace(/-/g, '');
  const sa = strip(a);
  const sb = strip(b);
  if (sa === sb) return 0;
  if (sa.replace(/s$/, '') === sb.replace(/s$/, '')) return 0;
  return levenshtein(sa, sb);
}

function levenshtein(a: string, b: string): number {
  const m = a.length;
  const n = b.length;
  if (m === 0) return n;
  if (n === 0) return m;
  let prev = Array.from({ length: n + 1 }, (_, i) => i);
  let curr = new Array<number>(n + 1);
  for (let i = 1; i <= m; i++) {
    curr[0] = i;
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      curr[j] = Math.min(prev[j] + 1, curr[j - 1] + 1, prev[j - 1] + cost);
    }
    [prev, curr] = [curr, prev];
  }
  return prev[n];
}
