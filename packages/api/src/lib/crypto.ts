import crypto from 'crypto';
import { env } from '../config/env';

// One operator secret (ENCRYPTION_KEY) feeds two derived keys via HKDF, so the
// key that encrypts stored API keys is never also used to sign OAuth state.
let encKey: Buffer | null = null;
let sigKey: Buffer | null = null;

function derive(info: string): Buffer {
  return Buffer.from(crypto.hkdfSync('sha256', env.encryptionKey, Buffer.alloc(0), info, 32));
}

function encryptionKey(): Buffer {
  return (encKey ??= derive('taro/encrypt/v1'));
}

function signingKey(): Buffer {
  return (sigKey ??= derive('taro/sign/v1'));
}

const ENC_PREFIX = 'enc:v1:';

/**
 * AES-256-GCM with a random IV. `context` is bound as associated data, so a
 * ciphertext copied onto another record (another workspace, another field)
 * fails to decrypt instead of silently working there.
 */
export function encryptSecret(plaintext: string, context: string): string {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', encryptionKey(), iv);
  cipher.setAAD(Buffer.from(context, 'utf8'));
  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${ENC_PREFIX}${iv.toString('base64url')}.${tag.toString('base64url')}.${ciphertext.toString('base64url')}`;
}

export function decryptSecret(value: string, context: string): string {
  if (!value.startsWith(ENC_PREFIX)) {
    throw new Error('Value is not encrypted');
  }
  const [iv, tag, ciphertext] = value.slice(ENC_PREFIX.length).split('.');
  if (!iv || !tag || !ciphertext) throw new Error('Malformed encrypted value');
  const decipher = crypto.createDecipheriv('aes-256-gcm', encryptionKey(), Buffer.from(iv, 'base64url'));
  decipher.setAAD(Buffer.from(context, 'utf8'));
  decipher.setAuthTag(Buffer.from(tag, 'base64url'));
  return Buffer.concat([decipher.update(Buffer.from(ciphertext, 'base64url')), decipher.final()]).toString('utf8');
}

export function isEncrypted(value: string): boolean {
  return value.startsWith(ENC_PREFIX);
}

/** Enough of a key to recognize it ("sk-a…a1b2") without revealing it. */
export function keyHint(key: string): string {
  const k = key.trim();
  if (k.length >= 16) return `${k.slice(0, 4)}…${k.slice(-4)}`;
  return `…${k.slice(-2)}`;
}

export function randomToken(bytes = 32): string {
  return crypto.randomBytes(bytes).toString('base64url');
}

export function sha256(value: string): string {
  return crypto.createHash('sha256').update(value).digest('hex');
}

export function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  return ab.length === bb.length && crypto.timingSafeEqual(ab, bb);
}

/**
 * Compact HMAC-signed token for stateless OAuth `state` values. `typ` pins
 * each token to one flow, so a sign-in state can't be replayed as an install
 * state. The payload is readable (base64url JSON), never secret.
 */
export function signToken(typ: string, payload: Record<string, unknown>, ttlSeconds: number): string {
  const body = Buffer.from(
    JSON.stringify({ ...payload, typ, exp: Math.floor(Date.now() / 1000) + ttlSeconds })
  ).toString('base64url');
  const sig = crypto.createHmac('sha256', signingKey()).update(body).digest('base64url');
  return `${body}.${sig}`;
}

export function verifyToken<T extends Record<string, unknown>>(typ: string, token: string | undefined): T | null {
  if (!token || typeof token !== 'string') return null;
  const dot = token.lastIndexOf('.');
  if (dot <= 0) return null;
  const body = token.slice(0, dot);
  const sig = token.slice(dot + 1);
  const expected = crypto.createHmac('sha256', signingKey()).update(body).digest('base64url');
  if (!safeEqual(sig, expected)) return null;
  try {
    const payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8')) as T & {
      typ?: string;
      exp?: number;
    };
    if (payload.typ !== typ) return null;
    if (typeof payload.exp !== 'number' || payload.exp < Math.floor(Date.now() / 1000)) return null;
    return payload;
  } catch {
    return null;
  }
}
