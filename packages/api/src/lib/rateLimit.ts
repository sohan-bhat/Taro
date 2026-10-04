import type { Request, Response, NextFunction, RequestHandler } from 'express';

/**
 * Fixed-window in-memory counter. Per instance, so behind N replicas the
 * effective limit is N times this; that is fine for abuse damping, which is
 * all this is for.
 */
export function windowCounter(opts: { windowMs: number; max: number }) {
  const hits = new Map<string, { count: number; resetAt: number }>();

  const sweep = setInterval(() => {
    const now = Date.now();
    for (const [k, v] of hits) if (v.resetAt <= now) hits.delete(k);
  }, Math.max(opts.windowMs, 60_000));
  sweep.unref();

  return {
    /** Counts one more for `key`; `allowed` is false once it's over the limit for this window. */
    hit(key: string): { allowed: boolean; resetAt: number } {
      const now = Date.now();
      let entry = hits.get(key);
      if (!entry || entry.resetAt <= now) {
        entry = { count: 0, resetAt: now + opts.windowMs };
        hits.set(key, entry);
      }
      entry.count += 1;
      return { allowed: entry.count <= opts.max, resetAt: entry.resetAt };
    },
  };
}

/** The counter as route middleware, keyed by client IP unless `key` says otherwise. */
export function rateLimit(opts: {
  windowMs: number;
  max: number;
  key?: (req: Request) => string;
  message?: string;
}): RequestHandler {
  const counter = windowCounter(opts);

  return (req: Request, res: Response, next: NextFunction) => {
    const key = opts.key ? opts.key(req) : req.ip || 'unknown';
    const { allowed, resetAt } = counter.hit(key);
    if (!allowed) {
      res.setHeader('Retry-After', Math.ceil((resetAt - Date.now()) / 1000));
      return res.status(429).json({
        error: opts.message || 'Too many requests. Try again in a moment.',
        code: 'RATE_LIMITED',
      });
    }
    next();
  };
}
