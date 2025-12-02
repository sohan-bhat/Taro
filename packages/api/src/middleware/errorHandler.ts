import { Request, Response, NextFunction, RequestHandler } from 'express';
import crypto from 'crypto';
import { AppError } from '../lib/errors';

/**
 * Global error handler middleware.
 * Converts errors to consistent JSON responses with request IDs for debugging.
 */
export function errorHandler(
  err: Error,
  req: Request,
  res: Response,
  next: NextFunction
) {
  const requestId = crypto.randomUUID().slice(0, 8);

  if (err instanceof AppError) {
    // Known application error - log concisely
    console.error(`[${requestId}] ${err.code}: ${err.message}`, err.details || '');

    return res.status(err.statusCode).json({
      error: err.message,
      code: err.code,
      requestId,
      ...(err.details ? { details: err.details } : {}),
    });
  }

  // Unexpected error - log full stack trace
  console.error(`[${requestId}] Unexpected error:`, err);

  return res.status(500).json({
    error: 'Internal server error',
    code: 'INTERNAL_ERROR',
    requestId,
  });
}

/**
 * Wrapper for async route handlers to catch errors and pass to errorHandler.
 * Usage: router.get('/path', asyncHandler(async (req, res) => { ... }))
 */
export function asyncHandler(
  fn: (req: Request, res: Response, next: NextFunction) => Promise<any>
): RequestHandler {
  return (req, res, next) => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
}
