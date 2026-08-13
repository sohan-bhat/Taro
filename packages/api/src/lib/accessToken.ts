import crypto from 'crypto';

/**
 * Workspace access tokens: the day-to-day credential after a license is
 * redeemed (the license key itself is only used for activation/recovery,
 * the way Adobe retires a redemption code once it's attached to an account).
 * Only a SHA-256 hash is stored; the raw token is shown once.
 */

export function generateAccessToken(): { token: string; tokenHash: string } {
  const token = `taro_sat_${crypto.randomBytes(24).toString('hex')}`;
  return { token, tokenHash: hashAccessToken(token) };
}

export function hashAccessToken(token: string): string {
  return crypto.createHash('sha256').update(token).digest('hex');
}
