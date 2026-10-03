import { WebClient } from '@slack/web-api';
import { SlackConnectionModel } from '../db/models';
import { decryptSecret, encryptSecret, isEncrypted } from '../lib/crypto';
import { log, errorMessage } from '../lib/logger';

// Bot tokens are stored encrypted with the Slack team bound as context.
export function slackTokenContext(teamId: string): string {
  return `slack:${teamId}`;
}

export function sealSlackToken(token: string, teamId: string): string {
  return encryptSecret(token, slackTokenContext(teamId));
}

export function readSlackToken(connection: { accessToken: string; teamId: string }): string {
  // Tokens saved before encryption existed are migrated at boot; read them as-is until then.
  return isEncrypted(connection.accessToken)
    ? decryptSecret(connection.accessToken, slackTokenContext(connection.teamId))
    : connection.accessToken;
}

export interface SlackStanding {
  active: boolean; // false for deactivated accounts
  guest: boolean; // single and multi-channel guests
  role: 'owner' | 'admin' | 'member';
}

export interface SlackPostResult {
  success: boolean;
  channel?: string; // where it was posted, after fuzzy matching
  notFound?: boolean; // no public channel has that name
  slackError?: string; // Slack's own error code when Slack answered, like not_in_channel
  error?: string; // what went wrong, for the log
}

interface PublicChannel {
  id: string;
  name: string;
  isMember: boolean;
}

// Platform errors carry Slack's error code; network failures don't.
function slackErrorCode(error: unknown): string | undefined {
  const code = (error as { data?: { error?: unknown } } | null)?.data?.error;
  return typeof code === 'string' ? code : undefined;
}

// Far past any real workspace. It only stops a cursor that never ends.
const MAX_CHANNEL_PAGES = 100;

export class SlackService {
  private client: WebClient;
  private companyId: string;

  constructor(accessToken: string, companyId: string) {
    this.client = new WebClient(accessToken);
    this.companyId = companyId;
  }

  static async fromCompanyId(companyId: string): Promise<SlackService | null> {
    const connection = await SlackConnectionModel.findOne({ companyId });
    if (!connection) {
      return null;
    }
    return new SlackService(readSlackToken(connection), companyId);
  }

  /** Where someone stands in the Slack workspace. Null when Slack can't say (network, missing scope). */
  async memberStanding(slackUserId: string): Promise<SlackStanding | null> {
    try {
      const { user } = await this.client.users.info({ user: slackUserId });
      if (!user) return null;
      return {
        active: !user.deleted && !user.is_bot,
        guest: !!(user.is_restricted || user.is_ultra_restricted),
        role: user.is_owner || user.is_primary_owner ? 'owner' : user.is_admin ? 'admin' : 'member',
      };
    } catch (error) {
      if (slackErrorCode(error) === 'user_not_found') return { active: false, guest: false, role: 'member' };
      return null;
    }
  }

  /** Posts in a public channel by its spoken name ("socials" finds #social). */
  async postMessage(channel: string, text: string): Promise<SlackPostResult> {
    const name = channel.replace(/^#/, '').trim();
    try {
      const match = await this.resolveChannel(name);
      // The dashboard recognizes this wording, so keep it.
      if (!match) return { success: false, notFound: true, error: `Channel "${name}" not found.` };

      // Slack only lets members post. Joining a channel Taro is already in is harmless.
      await this.client.conversations.join({ channel: match.id }).catch(() => {});
      await this.client.chat.postMessage({ channel: match.id, text });
      return { success: true, channel: match.name };
    } catch (error) {
      const slackError = slackErrorCode(error);
      log.warn(`[Slack] Couldn't post in #${name}:`, slackError ?? errorMessage(error));
      return { success: false, slackError, error: slackError ?? errorMessage(error) };
    }
  }

  // Slack only delivers channel messages to apps that are members, so join every
  // public channel once after install, page by page.
  async joinAllPublicChannels(): Promise<number> {
    let joined = 0;
    try {
      for await (const page of this.publicChannelPages()) {
        for (const ch of page) {
          if (ch.isMember) continue;
          try {
            await this.client.conversations.join({ channel: ch.id });
            joined++;
          } catch (error) {
            log.warn(`[Slack] Could not join #${ch.name}:`, slackErrorCode(error) ?? errorMessage(error));
          }
        }
      }
    } catch (error) {
      log.warn('[Slack] Could not list channels to join:', slackErrorCode(error) ?? errorMessage(error));
    }
    return joined;
  }

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
      const code = slackErrorCode(error);
      log.warn('[Slack] Thread post failed:', code ?? errorMessage(error));
      return { success: false, error: code ?? errorMessage(error) };
    }
  }

  /** The public channel a spoken name means, or null. Throws when Slack can't list channels. */
  async resolveChannel(channelName: string): Promise<{ id: string; name: string; exact: boolean } | null> {
    const channels: PublicChannel[] = [];
    for await (const page of this.publicChannelPages()) channels.push(...page);
    const found = matchChannel(channelName, channels);
    if (!found) return null;
    if (!found.exact) log.debug(`[Slack] Channel "${channelName}" not exact; using the closest match "#${found.channel.name}"`);
    return { id: found.channel.id, name: found.channel.name, exact: found.exact };
  }

  // Public channels only: asking for private_channel without the groups:read scope makes
  // Slack reject the whole call with missing_scope. A page holds at most 1000 channels.
  private async *publicChannelPages(): AsyncGenerator<PublicChannel[]> {
    let cursor: string | undefined;
    for (let page = 0; page < MAX_CHANNEL_PAGES; page++) {
      const result = await this.client.conversations.list({
        types: 'public_channel',
        exclude_archived: true,
        limit: 1000,
        ...(cursor ? { cursor } : {}),
      });
      yield (result.channels ?? []).flatMap((ch) =>
        ch.id && ch.name ? [{ id: ch.id, name: ch.name, isMember: !!ch.is_member }] : []
      );
      cursor = result.response_metadata?.next_cursor || undefined;
      if (!cursor) return;
    }
  }
}

/**
 * The channel a spoken name means: an exact match first, then the closest one,
 * within a tolerance that grows with the name so short names stay strict.
 */
export function matchChannel<T extends { name: string }>(
  spoken: string,
  channels: readonly T[]
): { channel: T; exact: boolean } | null {
  const target = normalizeChannel(spoken);
  if (!target) return null;

  const exact = channels.find((ch) => normalizeChannel(ch.name) === target);
  if (exact) return { channel: exact, exact: true };

  let best: T | null = null;
  let bestDistance = Infinity;
  for (const ch of channels) {
    const distance = channelDistance(target, normalizeChannel(ch.name));
    if (distance < bestDistance) {
      bestDistance = distance;
      best = ch;
    }
  }
  const tolerance = Math.max(1, Math.floor(target.length / 4));
  return best && bestDistance <= tolerance ? { channel: best, exact: false } : null;
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

// Levenshtein distance, except a trailing plural "s" or hyphen difference
// costs nothing, so obvious spoken variants resolve cleanly.
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
