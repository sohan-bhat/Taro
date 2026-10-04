/**
 * Where a mail provider posts the invitations people send to their workspace's Taro address:
 * Postmark's inbound JSON, or a raw message from a Cloudflare Email Worker (or any provider that
 * forwards mail as is). It's public, so INBOUND_SECRET guards it, as HTTP basic auth (Postmark
 * carries it in the webhook URL) or an X-Inbound-Secret header. Mounted ahead of the JSON body
 * parser, because it reads its own body with its own size cap. Mail Taro can't use still gets a
 * 200, so providers don't retry it for hours.
 */

import express, { Router, type NextFunction, type Request, type Response, type Router as RouterType } from 'express';
import { env } from '../config/env';
import { asyncHandler } from '../middleware/errorHandler';
import { calendarInvitesConfigured } from '../lib/inviteAddress';
import { safeEqual, sha256 } from '../lib/crypto';
import { log, errorMessage } from '../lib/logger';
import { readPostmark, readRawMail, type InboundMail } from '../services/calendar/mail';
import { receiveMail } from '../services/calendar/invitations';

// Postmark sends attachments as base64 inside the JSON, so this leaves room for a few megabytes of mail.
const MAX_BODY = '12mb';

export const inboundRouter: RouterType = Router();

/** The secret the caller presented: a basic auth password, or the X-Inbound-Secret header. */
export function presentedSecret(req: Pick<Request, 'header'>): string {
  const header = req.header('x-inbound-secret');
  if (header) return header.trim();
  const auth = req.header('authorization') ?? '';
  if (!/^basic\s/i.test(auth)) return '';
  const decoded = Buffer.from(auth.slice(6).trim(), 'base64').toString('utf8');
  const colon = decoded.indexOf(':');
  return colon >= 0 ? decoded.slice(colon + 1) : '';
}

/** Hashed first, so the comparison takes the same time whatever was sent. */
export function secretMatches(presented: string, expected: string): boolean {
  return !!presented && !!expected && safeEqual(sha256(presented), sha256(expected));
}

function checkSecret(req: Request, res: Response, next: NextFunction) {
  if (!calendarInvitesConfigured()) return res.status(404).json({ error: 'Not found', code: 'NOT_FOUND' });
  if (!secretMatches(presentedSecret(req), env.inboundSecret)) {
    res.setHeader('WWW-Authenticate', 'Basic realm="taro-inbound"');
    return res.status(401).json({ error: 'Unauthorized', code: 'UNAUTHORIZED' });
  }
  next();
}

const readBody = express.raw({ type: () => true, limit: MAX_BODY });

// Too large or unreadable: read off and dropped with a 200, since retrying won't change it.
function unusableBody(error: unknown, _req: Request, res: Response, next: NextFunction) {
  const type = (error as { type?: unknown } | null)?.type;
  if (type === 'entity.too.large') return res.status(200).json({ ignored: 'too_large' });
  if (typeof type === 'string' && /^(request\.aborted|encoding\.unsupported|charset\.unsupported|entity\.verify\.failed)$/.test(type)) {
    return res.status(200).json({ ignored: 'unreadable' });
  }
  next(error);
}

// A Cloudflare Email Worker passes the address the message was delivered to, which may not be in To or Cc.
function envelopeRecipients(req: Request): string[] {
  return (req.header('x-envelope-to') ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
    .slice(0, 10);
}

inboundRouter.post(
  '/email',
  checkSecret,
  readBody,
  unusableBody,
  asyncHandler(async (req: Request, res: Response) => {
    const body = Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0);
    let mail: InboundMail | null = null;
    try {
      if ((req.header('content-type') ?? '').toLowerCase().includes('json')) {
        mail = await readPostmark(JSON.parse(body.toString('utf8')));
      } else if (body.length > 0) {
        mail = await readRawMail(body, envelopeRecipients(req));
      }
    } catch (error) {
      log.debug('[Inbound] Unreadable mail:', errorMessage(error));
      return res.json({ ignored: 'unreadable' });
    }
    if (!mail || mail.calendars.length === 0) return res.json({ ignored: 'no_invitation' });
    // Database trouble surfaces as a 500, so the provider tries again later.
    res.json(await receiveMail(mail));
  })
);
