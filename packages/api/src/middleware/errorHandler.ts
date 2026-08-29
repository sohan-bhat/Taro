import { Request, Response, NextFunction, RequestHandler } from 'express';
import crypto from 'crypto';
import { AppError } from '../lib/errors';

// Tags each response with a request ID so a report from a user can be correlated with server logs.
export function errorHandler(
  err: Error,
  req: Request,
  res: Response,
  next: NextFunction
) {
  const requestId = crypto.randomUUID().slice(0, 8);

  if (err instanceof AppError) {
    console.error(`[${requestId}] ${err.code}: ${err.message}`, err.details || '');

    return res.status(err.statusCode).json({
      error: err.message,
      code: err.code,
      requestId,
      ...(err.details ? { details: err.details } : {}),
    });
  }

  console.error(`[${requestId}] Unexpected error:`, err);

  return res.status(500).json({
    error: 'Internal server error',
    code: 'INTERNAL_ERROR',
    requestId,
  });
}

// Express doesn't catch rejected promises from async handlers on its own; this forwards them to errorHandler.
export function asyncHandler(
  fn: (req: Request, res: Response, next: NextFunction) => Promise<any>
): RequestHandler {
  return (req, res, next) => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
}
