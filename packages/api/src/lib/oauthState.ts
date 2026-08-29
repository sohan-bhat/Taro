/**
 * OAuth `state` codec: packs companyId and the originating origin (Vercel in
 * prod, localhost in dev) so the callback can send the user back to wherever
 * they started, instead of one hard-coded NEXT_PUBLIC_APP_URL. Still decodes
 * a legacy bare-companyId state.
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
 * Reduces a caller-supplied URL to a bare, trusted origin, to guard against
 * open-redirect abuse: only https (any host) or localhost is allowed, and any
 * path or query is dropped.
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
  }
  return undefined;
}
