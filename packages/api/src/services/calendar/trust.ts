/**
 * Who may invite Taro. An invitation joins on its own when a member of the workspace vouches for
 * it: the member sent it, or a member organized it and the mail came from them. Anything else
 * waits for an owner or admin to approve it.
 *
 * An invitation's ORGANIZER is whatever its sender typed, so on its own it proves nothing: anyone
 * can attach a made-up invitation naming a member as organizer. The organizer only counts when
 * the mail came from that organizer, from their company's domain, or from Google Calendar
 * sending on their behalf.
 */

import { WebClient } from '@slack/web-api';
import { SlackConnectionModel, UserModel } from '../../db/models';
import type { CompanyDoc } from '../../db/models/Company';
import { log, errorMessage } from '../../lib/logger';
import { readSlackToken, SlackService } from '../slack';
import type { Sponsor } from './series';

// Calendar services that send invitations for the organizer from their own address.
const CALENDAR_SENDERS = new Set(['calendar-notification@google.com']);
// Anyone can get an address at these, so sharing one says nothing about who someone is.
const PUBLIC_DOMAINS = new Set([
  'gmail.com',
  'googlemail.com',
  'outlook.com',
  'hotmail.com',
  'live.com',
  'msn.com',
  'yahoo.com',
  'icloud.com',
  'me.com',
  'mac.com',
  'aol.com',
  'proton.me',
  'protonmail.com',
  'gmx.com',
  'gmx.net',
  'mail.com',
  'zoho.com',
  'yandex.com',
  'fastmail.com',
]);

const domainOf = (email: string) => email.slice(email.lastIndexOf('@') + 1);

/** The mail came from the organizer, their own company's domain, or a calendar service sending for them. */
export function senderSpeaksForOrganizer(from: string | undefined, organizer: string | undefined): boolean {
  if (!from || !organizer) return false;
  if (from === organizer || CALENDAR_SENDERS.has(from)) return true;
  const domain = domainOf(from);
  return domain === domainOf(organizer) && !PUBLIC_DOMAINS.has(domain);
}

export type MemberLookup = (email: string, name?: string) => Promise<Sponsor | null>;

/** The member who vouches for an invitation, or null. */
export async function findSponsor(
  mail: { from?: string; organizerEmail?: string; organizerName?: string },
  isMember: MemberLookup
): Promise<Sponsor | null> {
  if (mail.from) {
    const sender = await isMember(mail.from);
    if (sender) return sender;
  }
  if (mail.organizerEmail && mail.organizerEmail !== mail.from && senderSpeaksForOrganizer(mail.from, mail.organizerEmail)) {
    return isMember(mail.organizerEmail, mail.organizerName);
  }
  return null;
}

// ---------------------------------------------------------------------------------------------
// Membership

type Company = Pick<CompanyDoc, 'signInWith' | 'directoryId' | 'personal'> & { _id: unknown };

const CASE_INSENSITIVE = { locale: 'en', strength: 2 } as const;
const CACHE_MS = 10 * 60_000;
const cache = new Map<string, { sponsor: Sponsor | null; at: number }>();
// Workspaces whose Slack bot can't look people up by email (no users:read.email), so nobody asks again for a while
const slackLookupOff = new Map<string, number>();

function remember(key: string, sponsor: Sponsor | null): Sponsor | null {
  if (cache.size > 2000) cache.clear();
  cache.set(key, { sponsor, at: Date.now() });
  return sponsor;
}

/** A full member of the workspace's Slack, found by email. Undefined when Slack can't say. */
async function slackMemberByEmail(companyId: string, email: string): Promise<{ name: string; slackUserId: string; teamId: string } | null | undefined> {
  const off = slackLookupOff.get(companyId);
  if (off && Date.now() - off < 60 * 60_000) return undefined;
  const connection = await SlackConnectionModel.findOne({ companyId });
  if (!connection) return undefined;
  try {
    const { user } = await new WebClient(readSlackToken(connection), { retryConfig: { retries: 1 } }).users.lookupByEmail({ email });
    if (!user?.id || user.deleted || user.is_bot || user.is_restricted || user.is_ultra_restricted) return null;
    // Slack Connect can find people from other companies; only this workspace's own count.
    if (user.team_id && user.team_id !== connection.teamId) return null;
    const name = user.profile?.display_name || user.real_name || user.name || email;
    return { name, slackUserId: user.id, teamId: connection.teamId };
  } catch (error) {
    const code = (error as { data?: { error?: unknown } } | null)?.data?.error;
    if (code === 'users_not_found') return null;
    if (code === 'missing_scope' || code === 'not_allowed_token_type') slackLookupOff.set(companyId, Date.now());
    else log.debug('[Calendar] Slack lookup by email failed:', errorMessage(error));
    return undefined;
  }
}

/**
 * Whether an email belongs to a member of the workspace: someone signed in to Taro with it (and
 * not removed, and still a full member in Slack when Taro can check), anyone at a Google
 * workspace's own domain (the same people who can sign in), or a full member of the connected
 * Slack workspace when Taro's Slack bot may look people up by email.
 */
export function memberLookup(company: Company): MemberLookup {
  const companyId = String(company._id);
  return async (email, name) => {
    const key = `${companyId}:${email}`;
    const hit = cache.get(key);
    if (hit && Date.now() - hit.at < CACHE_MS) return hit.sponsor;

    const users = await UserModel.find({ companyId, email }).collation(CASE_INSENSITIVE).select('name removedAt slackUserId').limit(5);
    // Someone an owner removed never counts, whatever Slack or their domain says.
    if (users.some((u) => u.removedAt)) return remember(key, null);
    const user = users[0];
    if (user) {
      if (user.slackUserId) {
        const slack = await SlackService.fromCompanyId(companyId).catch(() => null);
        const standing = slack ? await slack.memberStanding(user.slackUserId) : null;
        if (standing && (!standing.active || standing.guest)) return remember(key, null);
      }
      return remember(key, { name: user.name, userId: String(user._id) });
    }

    const domain = domainOf(email);
    if (company.signInWith === 'google' && !company.personal && company.directoryId?.toLowerCase() === domain) {
      return remember(key, { name: name || email });
    }

    const slackMember = await slackMemberByEmail(companyId, email);
    if (slackMember) {
      const removed = await UserModel.exists({ slackTeamId: slackMember.teamId, slackUserId: slackMember.slackUserId, removedAt: { $exists: true } });
      return remember(key, removed ? null : { name: slackMember.name });
    }
    // Slack couldn't answer: not cached, so the next invitation asks again.
    return slackMember === undefined ? null : remember(key, null);
  };
}
