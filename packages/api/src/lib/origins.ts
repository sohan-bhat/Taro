import { env } from '../config/env';
import { log } from './logger';

function origin(value: string): string | null {
  try {
    const u = new URL(value);
    return `${u.protocol}//${u.host}`;
  } catch {
    return null;
  }
}

/**
 * Web origins the API trusts: the configured app URL, any extra WEB_ORIGINS,
 * and localhost during development. OAuth flows only ever redirect back to
 * one of these; redirecting a one-time login code to an arbitrary origin
 * would hand someone else the session.
 */
export function allowedWebOrigins(): string[] {
  const list = [env.appUrl, ...env.webOrigins];
  if (env.isDev) list.push('http://localhost:3000', 'http://127.0.0.1:3000');
  return [...new Set(list.map(origin).filter((o): o is string => !!o))];
}

// During development the dashboard may run on any local port.
function isLocalDevOrigin(o: string): boolean {
  if (!env.isDev) return false;
  const u = new URL(o);
  return u.protocol === 'http:' && (u.hostname === 'localhost' || u.hostname === '127.0.0.1');
}

/** Dashboard origins: the only places sign-in and install flows may return to. */
export function isAllowedOrigin(value: string | undefined): boolean {
  if (!value) return false;
  const o = origin(value);
  return !!o && (allowedWebOrigins().includes(o) || isLocalDevOrigin(o));
}

/** The Taro browser extension's origins. They may call the API, but are never a sign-in return target. */
export function extensionOrigins(): string[] {
  return env.extensionIds.map((id) => `chrome-extension://${id}`);
}

// Firefox gives each install of an extension its own random origin, so it can't be listed ahead of time.
// The API takes bearer tokens, not cookies, so any Firefox extension page may call it once the Meet
// button is turned on (EXTENSION_IDS is set); without a token it still gets nothing.
const FIREFOX_EXTENSION_ORIGIN = /^moz-extension:\/\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export function isAllowedCorsOrigin(value: string | undefined): boolean {
  if (!value) return false;
  if (env.extensionIds.length > 0 && FIREFOX_EXTENSION_ORIGIN.test(value)) return true;
  return isAllowedOrigin(value) || extensionOrigins().includes(value);
}

/** The caller's requested return origin if trusted, otherwise the app URL. */
export function resolveReturnTo(candidate: unknown): string {
  if (typeof candidate === 'string' && isAllowedOrigin(candidate)) return origin(candidate)!;
  const fallback = origin(env.appUrl) ?? env.appUrl;
  // Almost always a dashboard address missing from APP_URL or WEB_ORIGINS, which otherwise looks like a broken redirect.
  if (typeof candidate === 'string' && candidate) {
    log.warn(`[Origins] ${origin(candidate) ?? 'An invalid address'} isn't APP_URL or in WEB_ORIGINS, so this flow returns to ${fallback}. Add it to one of them.`);
  }
  return fallback;
}
