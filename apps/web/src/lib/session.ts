// Browser-side session storage. The session token lives in localStorage; the
// one-time sign-in nonce lives in sessionStorage, so a Slack sign-in can only
// be completed in the tab that started it.

const TOKEN_KEY = 'taro.session';
const NONCE_KEY = 'taro.loginNonce';
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
