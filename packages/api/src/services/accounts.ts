/**
 * Turns a verified identity into a Taro user and workspace, so colleagues who
 * sign in land together.
 *
 * Slack: one Slack workspace is one Taro workspace. Signing in first doesn't
 * make anyone the owner. A new workspace is claimed by whoever adds Taro to
 * Slack, which Slack itself has to allow. Once the bot is in, Slack's roles
 * carry over: Slack owners and admins are promoted, and guests and deactivated
 * accounts are turned away.
 *
 * Google and Microsoft: one company is one Taro workspace, found by its Google
 * Workspace domain or its Microsoft tenant. A personal account (Gmail,
 * Outlook.com) gets a workspace of its own. The first person in creates the
 * workspace and owns it; everyone after joins as a member, and owners promote
 * people from Members. Slack is an optional connection for these workspaces,
 * and its roles don't carry over.
 */

import type { WorkspaceRole } from '@taro/shared';
import { CompanyModel, SlackConnectionModel, UserModel } from '../db/models';
import { MICROSOFT_PERSONAL_TENANT, type GoogleAccount, type MicrosoftAccount } from '../lib/oidc';
import { log } from '../lib/logger';
import { SlackService, type SlackStanding } from './slack';

// use_google and use_microsoft: a Slack sign-in from a team that a Google or Microsoft workspace connected.
export type SignInRefusal = 'slack_guest' | 'slack_deactivated' | 'removed' | 'use_google' | 'use_microsoft';

export class SignInRefused extends Error {
  constructor(public code: SignInRefusal) {
    super(`Sign-in refused: ${code}`);
    this.name = 'SignInRefused';
  }
}

const RANK: Record<WorkspaceRole, number> = { member: 0, admin: 1, owner: 2 };

/** Slack roles only ever raise a Taro role; demoting someone is an owner's call. */
export function promotedRole(current: WorkspaceRole, slackRole: SlackStanding['role']): WorkspaceRole {
  return RANK[slackRole] > RANK[current] ? slackRole : current;
}

/** Null until Taro's bot is in the Slack workspace, or when Slack can't answer. */
export async function slackStanding(companyId: string, slackUserId: string): Promise<SlackStanding | null> {
  const slack = await SlackService.fromCompanyId(companyId);
  return slack ? slack.memberStanding(slackUserId) : null;
}

/** Records the first owner exactly once, however many people race for it. */
export async function claimOwnership(companyId: string, userId: string): Promise<boolean> {
  const claimed = await CompanyModel.findOneAndUpdate(
    { _id: companyId, ownerClaimedAt: { $exists: false } },
    { ownerClaimedAt: new Date() }
  );
  if (!claimed) return false;
  await UserModel.updateOne({ _id: userId, companyId }, { role: 'owner' });
  log.info(`[Accounts] User ${userId} claimed workspace ${companyId}`);
  return true;
}

/** The Taro role someone should have given their Slack role. A Slack owner or admin also claims a workspace nobody owns. */
export async function applySlackRole(
  companyId: string,
  userId: string,
  current: WorkspaceRole,
  slackRole: SlackStanding['role']
): Promise<WorkspaceRole> {
  if (slackRole !== 'member' && (await claimOwnership(companyId, userId))) return 'owner';
  return promotedRole(current, slackRole);
}

export interface SlackIdentity {
  teamId: string;
  teamName: string;
  teamDomain?: string;
  userId: string;
  name: string;
  email?: string;
  avatarUrl?: string;
}

function isDuplicateKey(error: unknown): boolean {
  return typeof error === 'object' && error !== null && (error as { code?: number }).code === 11000;
}

async function findOrCreateWorkspace(identity: SlackIdentity) {
  const existing = await CompanyModel.findOne({ slackTeamId: identity.teamId });
  if (existing) {
    if (identity.teamDomain && existing.slackTeamDomain !== identity.teamDomain) {
      existing.slackTeamDomain = identity.teamDomain;
      await existing.save();
    }
    return existing;
  }

  // A workspace from before sign-in existed, whose bot is installed in this team, is adopted rather than duplicated.
  const legacy = await SlackConnectionModel.findOne({ teamId: identity.teamId });
  if (legacy) {
    const adopted = await CompanyModel.findOneAndUpdate(
      { _id: legacy.companyId, slackTeamId: { $exists: false } },
      { $set: { slackTeamId: identity.teamId, slackTeamDomain: identity.teamDomain } },
      { new: true }
    );
    if (adopted) {
      log.info(`[Accounts] Adopted existing workspace "${adopted.name}" for Slack team ${identity.teamId}`);
      return adopted;
    }
  }

  try {
    return await CompanyModel.create({
      name: identity.teamName,
      slackTeamId: identity.teamId,
      slackTeamDomain: identity.teamDomain,
    });
  } catch (error) {
    // Two teammates signing in at the same moment: the other request created it
    if (isDuplicateKey(error)) {
      const created = await CompanyModel.findOne({ slackTeamId: identity.teamId });
      if (created) return created;
    }
    throw error;
  }
}

export async function signInWithSlack(identity: SlackIdentity) {
  const company = await findOrCreateWorkspace(identity);
  const companyId = company._id.toString();
  // A Google or Microsoft workspace connected this Slack team. Its people sign in the way it was made, so
  // nobody ends up there twice under two sign-ins, and Slack's roles never decide who runs it.
  if (company.signInWith) throw new SignInRefused(company.signInWith === 'google' ? 'use_google' : 'use_microsoft');

  const standing = await slackStanding(companyId, identity.userId);
  if (standing && !standing.active) throw new SignInRefused('slack_deactivated');
  if (standing?.guest) throw new SignInRefused('slack_guest');

  let user = await UserModel.findOne({ slackTeamId: identity.teamId, slackUserId: identity.userId });
  if (!user) {
    try {
      user = await UserModel.create({
        companyId,
        slackTeamId: identity.teamId,
        slackUserId: identity.userId,
        name: identity.name,
        role: 'member',
      });
    } catch (error) {
      if (!isDuplicateKey(error)) throw error;
      user = await UserModel.findOne({ slackTeamId: identity.teamId, slackUserId: identity.userId });
      if (!user) throw error;
    }
  }
  if (user.removedAt) throw new SignInRefused('removed');

  user.name = identity.name;
  user.email = identity.email;
  user.avatarUrl = identity.avatarUrl;
  user.companyId = companyId;
  user.lastSeenAt = new Date();
  if (standing) {
    user.role = await applySlackRole(companyId, user._id.toString(), user.role, standing.role);
    user.slackCheckedAt = new Date();
  }
  await user.save();

  return { company, user };
}

// ---------------------------------------------------------------------------------------------
// Google and Microsoft

export type DirectoryProvider = 'google' | 'microsoft';

/** Someone Google or Microsoft vouched for, and the workspace their account belongs to. */
export interface DirectoryIdentity {
  provider: DirectoryProvider;
  // What stays the same when their name or address changes: Google's sub, or Microsoft's "tid:oid"
  accountId: string;
  // Who they belong with: a Google Workspace domain, a Microsoft tenant, or "user:<id>" for a personal account
  directoryId: string;
  personal: boolean;
  // What a new workspace is called until someone renames it
  workspaceName: string;
  name: string;
  email?: string;
  avatarUrl?: string;
}

const firstWord = (s?: string) => s?.trim().split(/\s+/)[0] || undefined;
const personalWorkspaceName = (firstName?: string) => (firstName ? `${firstName}'s workspace` : 'My workspace');
const domainOf = (email?: string) => (email && email.includes('@') ? email.slice(email.lastIndexOf('@') + 1).toLowerCase() : undefined);

export function googleIdentity(account: GoogleAccount): DirectoryIdentity {
  const person = {
    provider: 'google' as const,
    accountId: account.sub,
    name: account.name ?? account.email,
    email: account.email,
    avatarUrl: account.picture,
  };
  // Google Workspace accounts carry their organization's domain (hd). Gmail accounts don't.
  if (account.hd) return { ...person, directoryId: account.hd, personal: false, workspaceName: account.hd };
  return {
    ...person,
    directoryId: `user:${account.sub}`,
    personal: true,
    workspaceName: personalWorkspaceName(account.givenName ?? firstWord(account.name)),
  };
}

export function microsoftIdentity(account: MicrosoftAccount): DirectoryIdentity {
  const person = {
    provider: 'microsoft' as const,
    accountId: `${account.tid}:${account.oid}`,
    name: account.name ?? account.email ?? 'Teammate',
    email: account.email,
  };
  if (account.tid === MICROSOFT_PERSONAL_TENANT) {
    return { ...person, directoryId: `user:${account.oid}`, personal: true, workspaceName: personalWorkspaceName(firstWord(account.name)) };
  }
  // The token doesn't name the organization, so the first person's email domain names the workspace.
  return { ...person, directoryId: account.tid, personal: false, workspaceName: domainOf(account.email) ?? 'My workspace' };
}

async function findOrCreateDirectoryWorkspace(identity: DirectoryIdentity) {
  const key = { signInWith: identity.provider, directoryId: identity.directoryId };
  const existing = await CompanyModel.findOne(key);
  if (existing) return existing;
  try {
    const created = await CompanyModel.create({ ...key, name: identity.workspaceName, ...(identity.personal ? { personal: true } : {}) });
    log.info(`[Accounts] Created ${identity.provider} workspace ${created._id}${identity.personal ? ' for a personal account' : ''}`);
    return created;
  } catch (error) {
    // Two colleagues signing in at the same moment: the other request created it
    if (isDuplicateKey(error)) {
      const created = await CompanyModel.findOne(key);
      if (created) return created;
    }
    throw error;
  }
}

async function findOrCreateDirectoryUser(identity: DirectoryIdentity, companyId: string) {
  const key = { signInWith: identity.provider, accountId: identity.accountId };
  const profile = {
    name: identity.name,
    lastSeenAt: new Date(),
    ...(identity.email ? { email: identity.email } : {}),
    ...(identity.avatarUrl ? { avatarUrl: identity.avatarUrl } : {}),
  };
  // A second pass only when a sign-in at the same moment created the record first
  for (let attempt = 0; attempt < 2; attempt++) {
    const existing = await UserModel.findOne(key);
    if (existing) {
      if (existing.removedAt) throw new SignInRefused('removed');
      // Their account now belongs to another workspace (a renamed domain, say), where they start as a member
      const moved = existing.companyId === companyId ? {} : { companyId, role: 'member' as const };
      const updated = await UserModel.findOneAndUpdate({ _id: existing._id }, { $set: { ...profile, ...moved } }, { new: true });
      if (updated) return updated;
      continue;
    }
    try {
      return await UserModel.create({ ...key, ...profile, companyId, role: 'member' });
    } catch (error) {
      if (!isDuplicateKey(error)) throw error;
    }
  }
  throw new Error('Could not save the account');
}

/** Signs in someone Google or Microsoft vouched for. The first person into a workspace owns it. */
export async function signInWithDirectory(identity: DirectoryIdentity) {
  const company = await findOrCreateDirectoryWorkspace(identity);
  const companyId = company._id.toString();
  const user = await findOrCreateDirectoryUser(identity, companyId);
  // Claimed once, atomically, so two colleagues signing in at the same moment can't both own it.
  if (!company.ownerClaimedAt && (await claimOwnership(companyId, user._id.toString()))) {
    user.role = 'owner';
    company.ownerClaimedAt = new Date();
  }
  return { company, user };
}

export type SlackLink = 'linked' | 'taken' | 'other_team';

/**
 * Connects a Slack team to a Google or Microsoft workspace. A Slack team belongs to one Taro workspace
 * at most, so a team that is already another workspace's (its own, or one it connected) is refused.
 */
export async function linkSlackTeam(companyId: string, teamId: string): Promise<SlackLink> {
  const connection = await SlackConnectionModel.findOne({ teamId });
  if (connection && connection.companyId !== companyId) return 'taken';
  const company = await CompanyModel.findOne({ _id: companyId });
  if (!company) return 'other_team';
  const current = company.slackTeamId;
  // A team that's still connected has to be removed first. One whose install never finished doesn't count.
  if (current && current !== teamId && (await SlackConnectionModel.exists({ teamId: current, companyId }))) return 'other_team';
  try {
    // Only if nothing changed in the meantime
    const result = await CompanyModel.updateOne({ _id: companyId, slackTeamId: current ?? null }, { $set: { slackTeamId: teamId } });
    return result.matchedCount > 0 ? 'linked' : 'other_team';
  } catch (error) {
    // The unique index on slackTeamId: another workspace has that team
    if (isDuplicateKey(error)) return 'taken';
    throw error;
  }
}

/** Lets a Google or Microsoft workspace's Slack team go, so it can connect another and the team is free again. */
export async function unlinkSlackTeam(companyId: string): Promise<void> {
  await CompanyModel.updateOne(
    { _id: companyId, signInWith: { $exists: true } },
    { $unset: { slackTeamId: 1, slackTeamDomain: 1 } }
  );
}
