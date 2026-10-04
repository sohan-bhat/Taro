/**
 * Checks on the ID token that finishes Sign in with Google. Taro gets the token straight from
 * Google's token endpoint over TLS, in exchange for a one-time code and its client secret, so the
 * token is Google's own and its signature needs no separate check (the same footing as Sign in with
 * Slack). What still has to hold is that it was issued for this app, for this sign-in attempt, by
 * Google, and that it hasn't expired.
 */

import { safeEqual, sha256 } from './crypto';

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
