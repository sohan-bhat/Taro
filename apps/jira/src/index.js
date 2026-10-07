// The Taro app for Jira's two functions: the admin page's resolver, which makes and removes the
// connection key, and the web trigger Taro calls, which makes each Jira change as the app.

import crypto from 'node:crypto';
import api, { assumeTrustedRoute, webTrigger } from '@forge/api';
import { kvs } from '@forge/kvs';
import Resolver from '@forge/resolver';
import { connectionKey, readCall, verify } from './gate.js';

const SECRET = 'taro-secret';
const META = 'taro-key-meta';

const pageResolver = new Resolver();

pageResolver.define('status', async () => {
  const meta = await kvs.get(META);
  return { hasKey: !!meta, createdAt: meta?.createdAt ?? null };
});

// A new key replaces the old one, so Taro stops working until the new key is pasted there.
pageResolver.define('createKey', async () => {
  const secret = crypto.randomBytes(32).toString('base64url');
  const url = await webTrigger.getUrl('taro-actions');
  await kvs.setSecret(SECRET, secret);
  const createdAt = new Date().toISOString();
  await kvs.set(META, { createdAt });
  return { key: connectionKey(url, secret), createdAt };
});

pageResolver.define('removeKey', async () => {
  await kvs.deleteSecret(SECRET);
  await kvs.delete(META);
  return { hasKey: false, createdAt: null };
});

export const resolver = pageResolver.getDefinitions();

const reply = (statusCode, data) => ({
  statusCode,
  headers: { 'Content-Type': ['application/json'] },
  body: JSON.stringify(data),
});

export async function actions(request) {
  if (request.method !== 'POST') return reply(405, { error: 'Only POST is accepted.' });
  const secret = await kvs.getSecret(SECRET);
  if (!secret) return reply(401, { error: 'No connection key has been made on the Taro page in Jira.' });
  if (!verify(secret, request.headers, request.body)) return reply(401, { error: 'The connection key does not match.' });

  const call = readCall(request.body);
  if (call.error) return reply(403, { error: call.error });

  const res = await api.asApp().requestJira(assumeTrustedRoute(call.path), {
    method: call.method,
    headers: { Accept: 'application/json', ...(call.body ? { 'Content-Type': 'application/json' } : {}) },
    ...(call.body ? { body: call.body } : {}),
  });
  const text = await res.text();
  let body = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = { message: text.slice(0, 500) };
  }
  // Jira's own status travels inside, so Taro can tell Jira's answer from the trigger's
  return reply(200, { status: res.status, body });
}
