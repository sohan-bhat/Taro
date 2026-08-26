/**
 * OAuth `state` codec. We need the callback to send the user back to whatever
 * origin they started from (Vercel in production, localhost in dev) instead of
 * a single hard-coded NEXT_PUBLIC_APP_URL. So we pack the companyId and the
 * originating origin into `state` and unpack them on the way back.
 *
 * Backward compatible: a legacy bare-companyId state still decodes correctly.
 */

export interface OAuthState {
  companyId: string;
  returnTo?: string;
}

export function encodeOAuthState(companyId: string, returnTo?: string): string {
  const safe = safeOrigin(returnTo);
  const payload = JSON.stringify({ c: companyId, ...(safe ? { r: safe } : {}) });
  return Buffer.from(payload, 'utf8').toString('base64url');
}

export function decodeOAuthState(raw: string): OAuthState {
  try {
    const json = JSON.parse(Buffer.from(raw, 'base64url').toString('utf8')) as {
      c?: unknown;
      r?: unknown;
    };
    if (json && typeof json.c === 'string') {
      return { companyId: json.c, returnTo: safeOrigin(typeof json.r === 'string' ? json.r : undefined) };
    }
  } catch {
    // Not our encoding: treat the whole value as a legacy bare companyId.
  }
  return { companyId: raw };
}

/**
 * Reduce a caller-supplied return URL to a bare, trusted origin. Guards against
 * open-redirect abuse: only https origins (any host) and localhost are allowed,
 * and any path/query is stripped so we only ever keep scheme + host.
 */
export function safeOrigin(returnTo?: string): string | undefined {
  if (!returnTo) return undefined;
  try {
    const u = new URL(returnTo);
    const localhost = u.hostname === 'localhost' || u.hostname === '127.0.0.1';
    if (u.protocol === 'https:' || (localhost && u.protocol === 'http:')) {
      return `${u.protocol}//${u.host}`;
    }
  } catch {
    // Malformed URL
  }
  return undefined;
}
