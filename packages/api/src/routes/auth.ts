import { Router, type Router as RouterType } from 'express';
import { CompanyModel, LicenseModel, AccessTokenModel } from '../db/models';
import { asyncHandler } from '../middleware/errorHandler';
import { requireAuth, type AuthedRequest } from '../middleware/auth';
import { ValidationError } from '../lib/errors';
import { normalizeLicenseKey } from '../lib/licenseKey';
import { generateAccessToken } from '../lib/accessToken';

export const authRouter: RouterType = Router();

// Sign in with the license key (proof of purchase). Issues a fresh access
// token; the key itself is never used as a session credential.
authRouter.post(
  '/recover',
  asyncHandler(async (req, res) => {
    const { licenseKey } = req.body as { licenseKey?: string };
    if (!licenseKey) {
      throw new ValidationError('licenseKey is required');
    }

    const license = await LicenseModel.findOne({ key: normalizeLicenseKey(licenseKey) });
    if (!license || !license.companyId) {
      return res.status(404).json({
        error: 'License key not recognized or not yet activated.',
        code: 'LICENSE_NOT_FOUND',
      });
    }
    if (license.revokedAt) {
      return res.status(403).json({
        error: 'This license has been revoked.',
        code: 'LICENSE_REVOKED',
      });
    }

    const company = await CompanyModel.findById(license.companyId);
    if (!company) {
      return res.status(404).json({ error: 'Workspace not found.', code: 'NOT_FOUND' });
    }

    const { token, tokenHash } = generateAccessToken();
    await AccessTokenModel.create({ tokenHash, companyId: company._id.toString() });

    res.json({ company, accessToken: token });
  })
);

// Who am I? Bootstraps the app from a stored access token.
authRouter.get(
  '/session',
  requireAuth,
  asyncHandler(async (req: AuthedRequest, res) => {
    const company = await CompanyModel.findById(req.companyId);
    if (!company) {
      return res.status(404).json({ error: 'Workspace not found.', code: 'NOT_FOUND' });
    }
    res.json({ company });
  })
);
