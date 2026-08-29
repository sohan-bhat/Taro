import { Router, type Router as RouterType } from 'express';
import {
  CompanyModel,
  SlackConnectionModel,
  GithubConnectionModel,
  LicenseModel,
  AccessTokenModel,
} from '../db/models';
import { asyncHandler } from '../middleware/errorHandler';
import { requireAuth, assertCompany, type AuthedRequest } from '../middleware/auth';
import { NotFoundError, ValidationError } from '../lib/errors';
import { normalizeLicenseKey } from '../lib/licenseKey';
import { generateAccessToken } from '../lib/accessToken';

export const companiesRouter: RouterType = Router();

// Activate a workspace with a purchased license key. The key is redeemed
// once; the response carries the access token used for everything after.
companiesRouter.post(
  '/',
  asyncHandler(async (req, res) => {
    const { name, domain, licenseKey } = req.body;

    if (!name || !domain || !licenseKey) {
      throw new ValidationError('Name, domain and licenseKey are required');
    }

    const normalizedKey = normalizeLicenseKey(licenseKey);
    const normalizedDomain = domain.toLowerCase().trim();

    const existing = await CompanyModel.findOne({ domain: normalizedDomain });
    if (existing) {
      return res.status(409).json({
        error: `A workspace for ${normalizedDomain} already exists. Sign in with its license key instead.`,
        code: 'WORKSPACE_EXISTS',
      });
    }

    // Atomic claim: only succeeds while the license is unclaimed, so two
    // simultaneous activations can't share a key
    const license = await LicenseModel.findOneAndUpdate(
      { key: normalizedKey, companyId: null, revokedAt: { $exists: false } },
      { $set: { claimedAt: new Date() } },
      { new: true }
    );
    if (!license) {
      const taken = await LicenseModel.findOne({ key: normalizedKey });
      if (taken?.revokedAt) {
        return res.status(403).json({
          error: 'This license has been revoked.',
          code: 'LICENSE_REVOKED',
        });
      }
      if (taken) {
        return res.status(409).json({
          error: 'This license key is already attached to a workspace. Sign in with it instead.',
          code: 'LICENSE_CLAIMED',
        });
      }
      return res.status(404).json({
        error: 'License key not recognized. Check the key from your purchase. Keys look like TARO-XXXX-XXXX-XXXX.',
        code: 'LICENSE_NOT_FOUND',
      });
    }

    try {
      const company = await CompanyModel.create({
        name: name.trim(),
        domain: normalizedDomain,
        licenseKey: normalizedKey,
      });
      license.companyId = company._id.toString();
      await license.save();

      const { token, tokenHash } = generateAccessToken();
      await AccessTokenModel.create({ tokenHash, companyId: company._id.toString() });

      res.status(201).json({ company, accessToken: token });
    } catch (error) {
      // Roll the claim back so the key stays usable
      license.claimedAt = undefined;
      await license.save();
      throw error;
    }
  })
);

companiesRouter.get(
  '/:id',
  requireAuth,
  asyncHandler(async (req: AuthedRequest, res) => {
    if (!assertCompany(req, res, req.params.id)) return;

    const company = await CompanyModel.findById(req.params.id);
    if (!company) {
      throw new NotFoundError('Company', req.params.id);
    }

    const slackConnection = await SlackConnectionModel.findOne({
      companyId: company._id,
    });

    res.json({
      ...company.toObject(),
      slackConnected: !!slackConnection,
      slackTeamName: slackConnection?.teamName,
    });
  })
);

companiesRouter.post(
  '/:id/onboarding-complete',
  requireAuth,
  asyncHandler(async (req: AuthedRequest, res) => {
    if (!assertCompany(req, res, req.params.id)) return;

    const company = await CompanyModel.findByIdAndUpdate(
      req.params.id,
      { onboardedAt: new Date() },
      { new: true }
    );
    if (!company) {
      throw new NotFoundError('Company', req.params.id);
    }
    res.json(company);
  })
);

companiesRouter.patch(
  '/:id',
  requireAuth,
  asyncHandler(async (req: AuthedRequest, res) => {
    if (!assertCompany(req, res, req.params.id)) return;

    const { name, domain } = req.body;
    const company = await CompanyModel.findByIdAndUpdate(
      req.params.id,
      { name, domain },
      { new: true }
    );

    if (!company) {
      throw new NotFoundError('Company', req.params.id);
    }

    res.json(company);
  })
);

companiesRouter.delete(
  '/:id',
  requireAuth,
  asyncHandler(async (req: AuthedRequest, res) => {
    if (!assertCompany(req, res, req.params.id)) return;

    const company = await CompanyModel.findByIdAndDelete(req.params.id);
    if (!company) {
      throw new NotFoundError('Company', req.params.id);
    }

    await SlackConnectionModel.deleteMany({ companyId: req.params.id });
    await GithubConnectionModel.deleteMany({ companyId: req.params.id });
    await AccessTokenModel.deleteMany({ companyId: req.params.id });

    res.json({ message: 'Company deleted' });
  })
);
