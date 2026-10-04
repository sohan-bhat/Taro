import type { Request, Response, NextFunction } from 'express';
import type { WorkspaceRole } from '@taro/shared';
import { SessionModel, UserModel } from '../db/models';
import type { SessionKind } from '../db/models/Session';
import { sha256, randomToken } from '../lib/crypto';
import { log, errorMessage } from '../lib/logger';
import { applySlackRole, slackStanding } from '../services/accounts';

const DAY_MS = 24 * 60 * 60 * 1000;
const SESSION_TTL_MS = 30 * DAY_MS;
// However active, a session ends this long after sign-in.
const SESSION_MAX_AGE_MS = 90 * DAY_MS;
// Sliding expiry and the Slack membership check run at most hourly, so an open
// dashboard isn't a write per request.
const TOUCH_INTERVAL_MS = 60 * 60 * 1000;

/**
 * Someone deactivated in Slack, or turned into a guest, loses Taro too; a
 * session alone shouldn't outlive their Slack account.
 */
async function recheckSlackMembership(user: {
  _id: unknown;
  companyId: string;
  slackUserId: string;
  role: WorkspaceRole;
}) {
  const standing = await slackStanding(user.companyId, user.slackUserId);
  if (!standing) return;
  if (!standing.active || standing.guest) {
    await SessionModel.deleteMany({ userId: String(user._id) });
    log.info(`[Auth] Signed out user ${String(user._id)}: no longer a full member of the Slack workspace`);
    return;
  }
  const role = await applySlackRole(user.companyId, String(user._id), user.role, standing.role);
  await UserModel.updateOne({ _id: user._id }, { role, slackCheckedAt: new Date() });
}

export interface AuthedRequest extends Request {
  companyId?: string;
  userId?: string;
  role?: WorkspaceRole;
  sessionId?: string;
  sessionKind?: SessionKind;
}

export async function createSession(
  userId: string,
  companyId: string,
  opts: { kind?: SessionKind; label?: string } = {}
): Promise<string> {
  const token = `taro_sess_${randomToken(32)}`;
  await SessionModel.create({
    tokenHash: sha256(token),
    userId,
    companyId,
    kind: opts.kind ?? 'web',
    label: opts.label,
    expiresAt: new Date(Date.now() + SESSION_TTL_MS),
    lastUsedAt: new Date(),
  });
  return token;
}

/** Signed-in dashboard sessions only. Extension sessions are refused here. */
export const requireAuth = authenticate(false);

/** Also lets in the browser extension's limited session, for the few routes it uses. */
export const requireAuthOrExtension = authenticate(true);

/** For routes behind requireAuthOrExtension that the extension must not reach. */
export function webSessionOnly(req: AuthedRequest, res: Response, next: NextFunction) {
  if (req.sessionKind === 'extension') return refuseExtension(res);
  next();
}

function refuseExtension(res: Response) {
  return res.status(403).json({ error: 'This browser connection can only send Taro to meetings.', code: 'EXTENSION_SESSION' });
}

function authenticate(allowExtension: boolean) {
  return (req: AuthedRequest, res: Response, next: NextFunction) => {
    checkSession(req, res, next, allowExtension).catch(next);
  };
}

async function checkSession(req: AuthedRequest, res: Response, next: NextFunction, allowExtension: boolean) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7).trim() : '';
  if (!token) {
    return res.status(401).json({ error: 'Sign in to continue.', code: 'UNAUTHENTICATED' });
  }

  const session = await SessionModel.findOne({ tokenHash: sha256(token), expiresAt: { $gt: new Date() } });
  if (!session) {
    return res.status(401).json({ error: 'Your session expired. Sign in again.', code: 'SESSION_EXPIRED' });
  }

  const user = await UserModel.findById(session.userId).select('companyId role slackUserId removedAt slackCheckedAt');
  if (!user || user.companyId !== session.companyId || user.removedAt) {
    await SessionModel.deleteOne({ _id: session._id });
    return res.status(401).json({ error: 'Sign in again.', code: 'SESSION_EXPIRED' });
  }

  const kind: SessionKind = session.kind ?? 'web';
  if (kind === 'extension' && !allowExtension) return refuseExtension(res);

  req.companyId = session.companyId;
  req.userId = session.userId;
  req.role = user.role;
  req.sessionId = session._id.toString();
  req.sessionKind = kind;

  const now = Date.now();
  if (!session.lastUsedAt || now - session.lastUsedAt.getTime() > TOUCH_INTERVAL_MS) {
    const hardStop = (session.createdAt?.getTime() ?? now) + SESSION_MAX_AGE_MS;
    SessionModel.updateOne(
      { _id: session._id },
      { lastUsedAt: new Date(now), expiresAt: new Date(Math.min(now + SESSION_TTL_MS, hardStop)) }
    ).catch(() => {});
    UserModel.updateOne({ _id: session.userId }, { lastSeenAt: new Date(now) }).catch(() => {});
  }
  // Only people who signed in with Slack answer to Slack; Google and Microsoft accounts have no Slack identity.
  const slackUserId = user.slackUserId;
  if (slackUserId && (!user.slackCheckedAt || now - user.slackCheckedAt.getTime() > TOUCH_INTERVAL_MS)) {
    // Mark first so concurrent requests don't all ask Slack
    UserModel.updateOne({ _id: user._id }, { slackCheckedAt: new Date(now) }).catch(() => {});
    recheckSlackMembership({ _id: user._id, companyId: user.companyId, role: user.role, slackUserId }).catch((error) =>
      log.warn('[Auth] Slack membership check failed:', errorMessage(error))
    );
  }
  next();
}

export function requireRole(...roles: WorkspaceRole[]) {
  return (req: AuthedRequest, res: Response, next: NextFunction) => {
    if (!req.role || !roles.includes(req.role)) {
      const ownerOnly = roles.length === 1 && roles[0] === 'owner';
      return res.status(403).json({
        error: ownerOnly ? 'Only a workspace owner can do this.' : 'Only workspace owners and admins can change this.',
        code: 'FORBIDDEN',
      });
    }
    next();
  };
}

export const requireAdmin = requireRole('owner', 'admin');
export const requireOwner = requireRole('owner');
