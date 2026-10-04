/**
 * Checks on the ID tokens that finish Sign in with Google and Sign in with Microsoft. Taro gets each
 * token straight from the provider's token endpoint over TLS, in exchange for a one-time code and its
 * client secret, so the token is the provider's own and its signature needs no separate check (the
 * same footing as Sign in with Slack). What still has to hold is that it was issued for this app, for
 * this sign-in attempt, by the tenant it names, and that it hasn't expired.
 */

import { safeEqual, sha256 } from './crypto';

// The tenant every personal Microsoft account (Outlook.com, Xbox, Skype) signs in through.
export const MICROSOFT_PERSONAL_TENANT = '9188040d-6c67-4c5b-b112-36a304b66dad';

const GUID = /^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;
// Clocks drift a little between Taro's host and the provider's.
const CLOCK_SKEW_S = 120;

export type Claims = Record<string, unknown>;

export class IdTokenRejected extends Error {
  constructor(
    public reason: 'unverified_email' | 'invalid',
    message: string
  ) {
    super(message);
    this.name = 'IdTokenRejected';
  }
}

const invalid = (why: string) => new IdTokenRejected('invalid', `The ID token ${why}`);

/** The OIDC nonce for a sign-in, derived from its signed state so it needs no server-side storage. */
export const oidcNonce = (state: string) => sha256(`oidc:${state}`).slice(0, 32);

export function decodeJwtPayload(jwt: string): Claims {
  const part = jwt.split('.')[1];
  if (!part) throw new Error('Malformed ID token');
  return JSON.parse(Buffer.from(part, 'base64url').toString('utf8')) as Claims;
}

export interface Expected {
  clientId: string;
  // What this sign-in sent as its nonce: oidcNonce(state)
  nonce: string;
  // Milliseconds, for tests
  now?: number;
}

const text = (value: unknown): string | undefined => (typeof value === 'string' && value.trim() ? value.trim() : undefined);

/** Issued to this app, for this sign-in attempt, and current. */
function checkAudienceAndTime(claims: Claims, { clientId, nonce, now = Date.now() }: Expected) {
  const audiences = Array.isArray(claims.aud) ? claims.aud : [claims.aud];
  if (!clientId || !audiences.includes(clientId)) throw invalid('was issued to another app');
  // A token for several audiences must name the one it was handed to
  if (audiences.length > 1 && claims.azp !== clientId) throw invalid('was issued to another app');
  const seconds = Math.floor(now / 1000);
  if (typeof claims.exp !== 'number' || claims.exp + CLOCK_SKEW_S < seconds) throw invalid('has expired');
  if (typeof claims.nbf === 'number' && claims.nbf - CLOCK_SKEW_S > seconds) throw invalid('is not valid yet');
  if (typeof claims.nonce !== 'string' || !safeEqual(claims.nonce, nonce)) throw invalid('belongs to another sign-in');
}

const isFalse = (value: unknown) => value === false || value === 'false';

export interface GoogleAccount {
  sub: string;
  email: string;
  // The Google Workspace (or Cloud Identity) domain. Personal Gmail accounts have none.
  hd?: string;
  name?: string;
  givenName?: string;
  picture?: string;
}

export function checkGoogleIdToken(claims: Claims, expected: Expected): GoogleAccount {
  if (claims.iss !== 'https://accounts.google.com' && claims.iss !== 'accounts.google.com') {
    throw invalid('came from another issuer');
  }
  checkAudienceAndTime(claims, expected);
  const sub = text(claims.sub);
  if (!sub) throw invalid('names nobody');
  const email = text(claims.email);
  // Google always says whether it confirmed the address; one it hasn't could be anyone's.
  if (!email || (claims.email_verified !== true && claims.email_verified !== 'true')) {
    throw new IdTokenRejected('unverified_email', "Google hasn't verified this account's email address");
  }
  return {
    sub,
    email,
    hd: text(claims.hd)?.toLowerCase(),
    name: text(claims.name),
    givenName: text(claims.given_name),
    picture: text(claims.picture),
  };
}

/** Whether MICROSOFT_AUTHORITY lets this tenant in. */
export function tenantAllowed(tid: string, authority: string): boolean {
  const t = tid.toLowerCase();
  if (authority === 'common') return true;
  if (authority === 'organizations') return t !== MICROSOFT_PERSONAL_TENANT;
  if (authority === 'consumers') return t === MICROSOFT_PERSONAL_TENANT;
  return t === authority.toLowerCase();
}

export interface MicrosoftAccount {
  tid: string;
  oid: string;
  // For display only. Microsoft doesn't verify it and it can change, so it never identifies anyone.
  email?: string;
  name?: string;
}

export function checkMicrosoftIdToken(claims: Claims, expected: Expected & { authority: string }): MicrosoftAccount {
  const tid = text(claims.tid);
  if (!tid || !GUID.test(tid)) throw invalid('names no tenant');
  // Under the common authority any tenant can answer, so the issuer must be the one for the tenant the token names.
  if (claims.iss !== `https://login.microsoftonline.com/${tid}/v2.0`) throw invalid('came from another issuer');
  if (!tenantAllowed(tid, expected.authority)) throw invalid("is from a tenant this server doesn't accept");
  checkAudienceAndTime(claims, expected);
  // The object ID stays with the account in its tenant, whatever happens to its name or address.
  const oid = text(claims.oid);
  if (!oid || !GUID.test(oid)) throw invalid('names nobody');
  // Microsoft rarely says either way; when it says the address is unverified, it's refused as Google's would be.
  if (isFalse(claims.email_verified)) {
    throw new IdTokenRejected('unverified_email', "Microsoft hasn't verified this account's email address");
  }
  const email = [claims.email, claims.preferred_username].map(text).find((value) => value?.includes('@'));
  return { tid: tid.toLowerCase(), oid: oid.toLowerCase(), email, name: text(claims.name) };
}
