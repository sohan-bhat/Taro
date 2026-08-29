import type { Request, Response, NextFunction } from 'express';
import { AccessTokenModel, LicenseModel } from '../db/models';
import { hashAccessToken } from '../lib/accessToken';

export interface AuthedRequest extends Request {
  companyId?: string;
}

/**
 * Bearer-token auth plus entitlement check: a valid token isn't enough, the
 * workspace's license must still be active, so revoking it cuts off access
 * immediately.
 */
export async function requireAuth(req: AuthedRequest, res: Response, next: NextFunction) {
  try {
    const header = req.headers.authorization || '';
    const token = header.startsWith('Bearer ') ? header.slice(7) : '';
    if (!token) {
      return res.status(401).json({ error: 'Sign in to continue.', code: 'UNAUTHENTICATED' });
    }

    const record = await AccessTokenModel.findOne({ tokenHash: hashAccessToken(token) });
    if (!record) {
      return res.status(401).json({ error: 'Session expired. Sign in again.', code: 'INVALID_TOKEN' });
    }

    const license = await LicenseModel.findOne({ companyId: record.companyId });
    if (!license || license.revokedAt) {
      return res.status(403).json({
        error: 'This workspace\'s license is no longer active.',
        code: 'LICENSE_REVOKED',
      });
    }

    req.companyId = record.companyId;
    // Fire-and-forget usage stamp
    AccessTokenModel.updateOne({ _id: record._id }, { lastUsedAt: new Date() }).catch(() => {});
    next();
  } catch (error) {
    next(error);
  }
}

export function assertCompany(req: AuthedRequest, res: Response, companyId: string): boolean {
  if (req.companyId !== companyId) {
    res.status(403).json({ error: 'You do not have access to this workspace.', code: 'FORBIDDEN' });
    return false;
  }
  return true;
}
