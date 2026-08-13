import { Router, type Router as RouterType } from 'express';
import { LicenseModel, CompanyModel } from '../db/models';
import { asyncHandler } from '../middleware/errorHandler';
import { ValidationError } from '../lib/errors';
import { normalizeLicenseKey } from '../lib/licenseKey';

export const licensesRouter: RouterType = Router();

// The landing page's single entry point: is this key unknown, ready to
// activate, or already attached to a workspace?
licensesRouter.post(
  '/lookup',
  asyncHandler(async (req, res) => {
    const { licenseKey } = req.body as { licenseKey?: string };
    if (!licenseKey) {
      throw new ValidationError('licenseKey is required');
    }

    const license = await LicenseModel.findOne({ key: normalizeLicenseKey(licenseKey) });
    if (!license) {
      return res.json({ status: 'not_found' });
    }

    if (license.companyId) {
      const company = await CompanyModel.findById(license.companyId);
      return res.json({ status: 'claimed', company });
    }

    res.json({ status: 'unclaimed' });
  })
);
