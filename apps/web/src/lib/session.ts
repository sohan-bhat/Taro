// Browser-side session storage. The session token lives in localStorage; the
// one-time sign-in nonce lives in sessionStorage, so a Slack sign-in can only
// be completed in the tab that started it.

const TOKEN_KEY = 'taro.session';
const NONCE_KEY = 'taro.loginNonce';
const NEXT_KEY = 'taro.loginNext';
// Left over from the license era; cleared so old browsers start clean.
const LEGACY_KEYS = ['taro.accessToken', 'taro.licenseKey'];

function storage(kind: 'local' | 'session'): Storage | null {
  try {
    return kind === 'local' ? window.localStorage : window.sessionStorage;
  } catch {
    return null;
  }
}

export function getToken(): string | null {
  if (typeof window === 'undefined') return null;
  return storage('local')?.getItem(TOKEN_KEY) ?? null;
}

// The root layout's head script reads the same flag before first paint, so CSS can show the right call to action.
function markSession(signedIn: boolean) {
  if (typeof document === 'undefined') return;
  if (signedIn) document.documentElement.dataset.session = 'in';
  else delete document.documentElement.dataset.session;
}

export function setToken(token: string) {
  const local = storage('local');
  local?.setItem(TOKEN_KEY, token);
  LEGACY_KEYS.forEach((k) => local?.removeItem(k));
  markSession(true);
}

export function clearToken() {
  storage('local')?.removeItem(TOKEN_KEY);
  markSession(false);
}

export function newLoginNonce(): string {
  const bytes = new Uint8Array(24);
  crypto.getRandomValues(bytes);
  const nonce = btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  storage('session')?.setItem(NONCE_KEY, nonce);
  return nonce;
}

/** Returns the stored nonce and forgets it, so a sign-in link works once. */
export function takeLoginNonce(): string | null {
  const session = storage('session');
  const nonce = session?.getItem(NONCE_KEY) ?? null;
  session?.removeItem(NONCE_KEY);
  return nonce;
}

/**
 * A page on this site to return to after signing in, or null. Anything that
 * could leave the site (another origin, a protocol-relative path) is refused,
 * so a crafted sign-in link can't send someone elsewhere afterward.
 */
export function safeNextPath(next: string | null | undefined): string | null {
  if (typeof window === 'undefined' || !next) return null;
  if (!next.startsWith('/') || next.startsWith('//') || next.startsWith('/\\') || /[\u0000-\u001f]/.test(next)) return null;
  try {
    const url = new URL(next, window.location.origin);
    return url.origin === window.location.origin ? url.pathname + url.search : null;
  } catch {
    return null;
  }
}

/** Kept for this tab only, next to the nonce, and read once by the callback. */
export function rememberLoginNext(next: string | null | undefined) {
  const safe = safeNextPath(next);
  const session = storage('session');
  if (safe) session?.setItem(NEXT_KEY, safe);
  else session?.removeItem(NEXT_KEY);
}

export function takeLoginNext(): string | null {
  const session = storage('session');
  const next = session?.getItem(NEXT_KEY) ?? null;
  session?.removeItem(NEXT_KEY);
  return safeNextPath(next);
}
