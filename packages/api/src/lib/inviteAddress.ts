/**
 * Each workspace's Taro address for calendar invitations: INVITE_ADDRESS with the workspace's
 * token where {token} is. A domain's catch-all ({token}@invite.example.com) and a provider's plus
 * addressing (abc123+{token}@inbound.postmarkapp.com) both work. The token is the only thing that
 * routes mail to a workspace, so it's long and random, and owners can rotate it.
 */

import { randomInt } from 'crypto';
import { env } from '../config/env';
import { log } from './logger';

const ALPHABET = '0123456789abcdefghijklmnopqrstuvwxyz';
// About 103 bits. Lowercase only, because mail systems and calendars change the case of addresses.
export const TOKEN_LENGTH = 20;
const TOKEN = new RegExp(`^[0-9a-z]{${TOKEN_LENGTH}}$`);
// The webhook's shared secret is checked in constant time, but a short one could still be guessed.
const MIN_SECRET_LENGTH = 24;

export function newInviteToken(): string {
  let token = '';
  for (let i = 0; i < TOKEN_LENGTH; i++) token += ALPHABET[randomInt(ALPHABET.length)];
  return token;
}

export function isInviteToken(value: unknown): value is string {
  return typeof value === 'string' && TOKEN.test(value);
}

/** What comes before and after {token}, lowercased. */
export interface AddressTemplate {
  prefix: string;
  suffix: string;
}

/** Null unless the template is one address with {token} once, in the part before the @. */
export function parseTemplate(raw: string): AddressTemplate | null {
  const parts = raw.trim().toLowerCase().split('{token}');
  if (parts.length !== 2) return null;
  const [prefix, suffix] = parts;
  if (prefix.includes('@') || !suffix.includes('@')) return null;
  const sample = `${prefix}${'a'.repeat(TOKEN_LENGTH)}${suffix}`;
  return /^[a-z0-9._%+=-]{1,64}@[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(sample) ? { prefix, suffix } : null;
}

export function addressWith(template: AddressTemplate, token: string): string {
  return `${template.prefix}${token}${template.suffix}`;
}

/** The token in an address made from the template, or null for any other address. */
export function tokenWith(template: AddressTemplate, address: string): string | null {
  const a = address.trim().toLowerCase();
  if (a.length !== template.prefix.length + TOKEN_LENGTH + template.suffix.length) return null;
  if (!a.startsWith(template.prefix) || !a.endsWith(template.suffix)) return null;
  const token = a.slice(template.prefix.length, a.length - template.suffix.length);
  return TOKEN.test(token) ? token : null;
}

let parsed: { raw: string; template: AddressTemplate | null } | null = null;

function template(): AddressTemplate | null {
  if (parsed?.raw !== env.inviteAddress) {
    const template = env.inviteAddress ? parseTemplate(env.inviteAddress) : null;
    if (env.inviteAddress && !template) {
      log.warn('[Calendar] INVITE_ADDRESS must be one email address with {token} before the @, so calendar invitations are off.');
    }
    parsed = { raw: env.inviteAddress, template };
  }
  return parsed.template;
}

let warnedSecret = false;

/** Both halves are set and usable: the address template and the webhook secret. */
export function calendarInvitesConfigured(): boolean {
  if (!template()) return false;
  if (env.inboundSecret.length >= MIN_SECRET_LENGTH) return true;
  if (env.inboundSecret && !warnedSecret) {
    warnedSecret = true;
    log.warn(`[Calendar] INBOUND_SECRET needs at least ${MIN_SECRET_LENGTH} characters, so calendar invitations are off.`);
  }
  return false;
}

export function inviteAddressFor(token: string): string | null {
  const t = template();
  return t ? addressWith(t, token) : null;
}

export function tokenFromAddress(address: string): string | null {
  const t = template();
  return t ? tokenWith(t, address) : null;
}
