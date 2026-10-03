import { env } from '../config/env';

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

export function isAllowedCorsOrigin(value: string | undefined): boolean {
  if (!value) return false;
  return isAllowedOrigin(value) || extensionOrigins().includes(value);
}

/** The caller's requested return origin if trusted, otherwise the app URL. */
export function resolveReturnTo(candidate: unknown): string {
  if (typeof candidate === 'string' && isAllowedOrigin(candidate)) return origin(candidate)!;
  return origin(env.appUrl) ?? env.appUrl;
}
