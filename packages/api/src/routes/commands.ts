import { Router, type Router as RouterType } from 'express';
import { ActionLogModel } from '../db/models';
import { asyncHandler } from '../middleware/errorHandler';
import { ValidationError } from '../lib/errors';

export const commandsRouter: RouterType = Router();

// Get recent action logs for a company (dashboard "Recent Actions" feed)
commandsRouter.get(
  '/logs',
  asyncHandler(async (req, res) => {
    const { companyId } = req.query;

    if (!companyId) {
      throw new ValidationError('companyId is required');
    }

    const logs = await ActionLogModel.find({ companyId })
      .sort({ createdAt: -1 })
      .limit(20);

    res.json(logs);
  })
);

// Get action logs for a meeting
commandsRouter.get(
  '/logs/:meetingId',
  asyncHandler(async (req, res) => {
    const logs = await ActionLogModel.find({ meetingId: req.params.meetingId })
      .sort({ createdAt: -1 })
      .limit(50);

    res.json(logs);
  })
);
