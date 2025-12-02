import { Router, type Router as RouterType } from 'express';
import { CompanyModel, SlackConnectionModel } from '../db/models';
import { asyncHandler } from '../middleware/errorHandler';
import { NotFoundError, ValidationError } from '../lib/errors';

export const companiesRouter: RouterType = Router();

// Get all companies
companiesRouter.get(
  '/',
  asyncHandler(async (req, res) => {
    const companies = await CompanyModel.find().sort({ createdAt: -1 }).limit(100);
    res.json(companies);
  })
);

// Get company by ID
companiesRouter.get(
  '/:id',
  asyncHandler(async (req, res) => {
    const company = await CompanyModel.findById(req.params.id);
    if (!company) {
      throw new NotFoundError('Company', req.params.id);
    }

    // Also fetch Slack connection status
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

// Create or get company
companiesRouter.post(
  '/',
  asyncHandler(async (req, res) => {
    const { name, domain } = req.body;

    if (!name || !domain) {
      throw new ValidationError('Name and domain are required');
    }

    // Normalize domain
    const normalizedDomain = domain.toLowerCase().trim();

    // If domain exists, return existing company
    const existing = await CompanyModel.findOne({ domain: normalizedDomain });
    if (existing) {
      return res.json(existing);
    }

    const company = await CompanyModel.create({
      name: name.trim(),
      domain: normalizedDomain,
    });
    res.status(201).json(company);
  })
);

// Update company
companiesRouter.patch(
  '/:id',
  asyncHandler(async (req, res) => {
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

// Delete company
companiesRouter.delete(
  '/:id',
  asyncHandler(async (req, res) => {
    const company = await CompanyModel.findByIdAndDelete(req.params.id);
    if (!company) {
      throw new NotFoundError('Company', req.params.id);
    }

    // Also delete associated Slack connection
    await SlackConnectionModel.deleteMany({ companyId: req.params.id });

    res.json({ message: 'Company deleted' });
  })
);
