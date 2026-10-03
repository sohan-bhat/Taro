/**
 * The Taro browser extension's connection, and the list of signed-in browsers.
 *
 * The dashboard's /extension/connect page asks for a token here and hands it
 * straight to the extension. That token is a limited session: it can send
 * Taro to a meeting, check on it, and make Taro leave, and nothing else
 * (see requireAuthOrExtension). People see and revoke these under
 * Connections in the dashboard.
 */

import { Router, type Router as RouterType } from 'express';
import { isValidObjectId } from 'mongoose';
import type { ConnectedSession } from '@taro/shared';
import { SessionModel } from '../db/models';
import { asyncHandler } from '../middleware/errorHandler';
import { createSession, requireAuth, type AuthedRequest } from '../middleware/auth';
import { NotFoundError } from '../lib/errors';
import { rateLimit } from '../lib/rateLimit';

// Older browser connections beyond this many are signed out when a new one connects.
const MAX_BROWSERS = 10;

export const extensionRouter: RouterType = Router();

const tokenLimiter = rateLimit({
  windowMs: 10 * 60_000,
  max: 10,
  key: (req) => `ext-token:${(req as AuthedRequest).userId}`,
  message: 'Too many browsers connected in a short time. Try again in a few minutes.',
});

extensionRouter.post(
  '/token',
  requireAuth,
  tokenLimiter,
  asyncHandler(async (req: AuthedRequest, res) => {
    const raw = (req.body ?? {}).label;
    const label = typeof raw === 'string' && raw.trim() ? raw.trim().slice(0, 60) : 'Browser';
    const token = await createSession(req.userId!, req.companyId!, { kind: 'extension', label });
    const older = await SessionModel.find({ userId: req.userId, kind: 'extension' })
      .sort({ createdAt: -1 })
      .skip(MAX_BROWSERS)
      .select('_id');
    if (older.length) await SessionModel.deleteMany({ _id: { $in: older.map((s) => s._id) } });
    res.status(201).json({ token, label });
  })
);

export const sessionsRouter: RouterType = Router();
sessionsRouter.use(requireAuth);

sessionsRouter.get(
  '/',
  asyncHandler(async (req: AuthedRequest, res) => {
    const sessions = await SessionModel.find({ userId: req.userId, expiresAt: { $gt: new Date() } })
      .sort({ lastUsedAt: -1 })
      .limit(50);
    const list: ConnectedSession[] = sessions.map((s) => ({
      _id: String(s._id),
      kind: s.kind ?? 'web',
      label: s.label,
      createdAt: s.createdAt.toISOString(),
      lastUsedAt: s.lastUsedAt?.toISOString(),
      current: String(s._id) === req.sessionId,
    }));
    res.json({ sessions: list });
  })
);

sessionsRouter.delete(
  '/:id',
  asyncHandler(async (req: AuthedRequest, res) => {
    if (!isValidObjectId(req.params.id)) throw new NotFoundError('Session');
    const result = await SessionModel.deleteOne({ _id: req.params.id, userId: req.userId });
    if (result.deletedCount === 0) throw new NotFoundError('Session');
    res.json({ revoked: true });
  })
);
