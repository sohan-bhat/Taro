/**
 * The dashboard's side of calendar invitations: the workspace's Taro address, and the meetings
 * Taro is invited to over the next two weeks. Everyone sees both; anyone can skip one occurrence;
 * owners and admins rotate the address and approve or decline invitations nobody vouched for.
 */

import { Router, type NextFunction, type Response, type Router as RouterType } from 'express';
import { isValidObjectId } from 'mongoose';
import { UserModel } from '../db/models';
import { asyncHandler } from '../middleware/errorHandler';
import { requireAdmin, requireAuth, type AuthedRequest } from '../middleware/auth';
import { NotFoundError } from '../lib/errors';
import { calendarInvitesConfigured, inviteAddressFor } from '../lib/inviteAddress';
import { rateLimit } from '../lib/rateLimit';
import {
  decideOccurrence,
  inviteTokenFor,
  restoreOccurrence,
  rotateInviteToken,
  skipOccurrence,
  upcomingFor,
} from '../services/calendar/invitations';

export const calendarRouter: RouterType = Router();
calendarRouter.use(requireAuth);
calendarRouter.use((_req: AuthedRequest, res: Response, next: NextFunction) => {
  if (calendarInvitesConfigured()) return next();
  res.status(404).json({ error: "Calendar invitations aren't set up on this Taro server.", code: 'NOT_CONFIGURED' });
});

// A new address means updating every meeting that has the old one; this only stops a stuck button.
const rotateLimiter = rateLimit({
  windowMs: 60 * 60_000,
  max: 10,
  key: (req) => `invite-rotate:${(req as AuthedRequest).companyId}`,
  message: 'The address was changed a lot in the last hour. Try again later.',
});

function occurrenceId(req: AuthedRequest): string {
  if (!isValidObjectId(req.params.id)) throw new NotFoundError('Meeting');
  return req.params.id;
}

calendarRouter.get(
  '/',
  asyncHandler(async (req: AuthedRequest, res) => {
    res.json({ address: inviteAddressFor(await inviteTokenFor(req.companyId!)) });
  })
);

calendarRouter.post(
  '/rotate',
  requireAdmin,
  rotateLimiter,
  asyncHandler(async (req: AuthedRequest, res) => {
    res.json({ address: inviteAddressFor(await rotateInviteToken(req.companyId!)) });
  })
);

calendarRouter.get(
  '/upcoming',
  asyncHandler(async (req: AuthedRequest, res) => {
    res.json({ upcoming: await upcomingFor(req.companyId!) });
  })
);

calendarRouter.post(
  '/upcoming/:id/skip',
  asyncHandler(async (req: AuthedRequest, res) => {
    await skipOccurrence(req.companyId!, occurrenceId(req), req.userId!);
    res.json({ upcoming: await upcomingFor(req.companyId!) });
  })
);

calendarRouter.post(
  '/upcoming/:id/restore',
  asyncHandler(async (req: AuthedRequest, res) => {
    await restoreOccurrence(req.companyId!, occurrenceId(req));
    res.json({ upcoming: await upcomingFor(req.companyId!) });
  })
);

for (const decision of ['approve', 'decline'] as const) {
  calendarRouter.post(
    `/upcoming/:id/${decision}`,
    requireAdmin,
    asyncHandler(async (req: AuthedRequest, res) => {
      const me = await UserModel.findById(req.userId).select('name');
      await decideOccurrence(req.companyId!, occurrenceId(req), decision, { userId: req.userId!, name: me?.name });
      res.json({ upcoming: await upcomingFor(req.companyId!) });
    })
  );
}
