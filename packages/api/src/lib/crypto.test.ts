import { test } from 'node:test';
import assert from 'node:assert/strict';
import { decryptSecret, encryptSecret, isEncrypted, keyHint, signToken, verifyToken } from './crypto';

test('encrypts and decrypts a key with its context', () => {
  const sealed = encryptSecret('sk-ant-secret-value-1234', 'company:abc:llm');
  assert.ok(isEncrypted(sealed));
  assert.ok(!sealed.includes('secret-value'));
  assert.equal(decryptSecret(sealed, 'company:abc:llm'), 'sk-ant-secret-value-1234');
});

test('the same plaintext encrypts differently every time', () => {
  assert.notEqual(encryptSecret('same', 'ctx'), encryptSecret('same', 'ctx'));
});

test('a ciphertext copied to another workspace does not decrypt', () => {
  const sealed = encryptSecret('sk-live-key', 'company:aaa:llm');
  assert.throws(() => decryptSecret(sealed, 'company:bbb:llm'));
  assert.throws(() => decryptSecret(sealed, 'company:aaa:stt'));
});

test('tampered ciphertext is rejected', () => {
  const sealed = encryptSecret('sk-live-key', 'ctx');
  const parts = sealed.split('.');
  const body = Buffer.from(parts[2], 'base64url');
  body[0] ^= 0xff;
  parts[2] = body.toString('base64url');
  assert.throws(() => decryptSecret(parts.join('.'), 'ctx'));
});

test('plaintext is never treated as encrypted', () => {
  assert.throws(() => decryptSecret('xoxb-plain-token', 'ctx'));
});

test('key hints reveal only the edges of a key', () => {
  assert.equal(keyHint('sk-ant-api03-abcdefghijklmnop-WXYZ'), 'sk-a…WXYZ');
  assert.equal(keyHint('short1234'), '…34');
});

test('signed tokens round-trip and are bound to their type', () => {
  const token = signToken('login', { r: 'https://app.taro.test', n: 'nonce-123' }, 60);
  const payload = verifyToken<{ r: string; n: string }>('login', token);
  assert.equal(payload?.r, 'https://app.taro.test');
  assert.equal(payload?.n, 'nonce-123');
  assert.equal(verifyToken('slack_install', token), null);
});

test('tampered or expired tokens are rejected', () => {
  const token = signToken('github', { c: 'company-1' }, 60);
  const [body, sig] = token.split('.');
  const forged = Buffer.from(JSON.stringify({ c: 'company-2', typ: 'github', exp: 9999999999 })).toString('base64url');
  assert.equal(verifyToken('github', `${forged}.${sig}`), null);
  assert.equal(verifyToken('github', `${body}.${sig.slice(0, -2)}xx`), null);
  assert.equal(verifyToken('github', signToken('github', { c: 'x' }, -1)), null);
  assert.equal(verifyToken('github', undefined), null);
  assert.equal(verifyToken('github', 'not-a-token'), null);
});
