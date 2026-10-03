/**
 * Turns a verified Slack identity into a Taro user and workspace. One Slack
 * workspace is one Taro workspace, so teammates who sign in land together.
 *
 * Signing in first doesn't make anyone the owner. A new workspace is claimed
 * by whoever adds Taro to Slack, which Slack itself has to allow. Once the bot
 * is in, Slack's roles carry over: Slack owners and admins are promoted, and
 * guests and deactivated accounts are turned away.
 */

import type { WorkspaceRole } from '@taro/shared';
import { CompanyModel, SlackConnectionModel, UserModel } from '../db/models';
import { log } from '../lib/logger';
import { SlackService, type SlackStanding } from './slack';

export type SignInRefusal = 'slack_guest' | 'slack_deactivated' | 'removed';

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
