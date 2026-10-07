// What the web trigger lets through, kept free of Forge imports so it can be tested with plain Node.
// Taro signs every request with the secret in the connection key; the trigger passes on only the
// Jira calls listed here, with only the query parameters Taro uses.

import crypto from 'node:crypto';

const KEY = '[A-Z][A-Z0-9_]{0,9}';
const ISSUE = `${KEY}-\\d{1,7}`;

export const ALLOWED = [
  ['GET', new RegExp('^/rest/api/3/serverInfo$')],
  ['GET', new RegExp('^/rest/api/3/project/search$')],
  ['GET', new RegExp(`^/rest/api/3/issue/createmeta/${KEY}/issuetypes$`)],
  ['POST', new RegExp('^/rest/api/3/issue$')],
  ['POST', new RegExp(`^/rest/api/3/issue/${ISSUE}/comment$`)],
  ['GET', new RegExp(`^/rest/api/3/issue/${ISSUE}/transitions$`)],
  ['POST', new RegExp(`^/rest/api/3/issue/${ISSUE}/transitions$`)],
  ['PUT', new RegExp(`^/rest/api/3/issue/${ISSUE}$`)],
  ['PUT', new RegExp(`^/rest/api/3/issue/${ISSUE}/assignee$`)],
  ['GET', new RegExp('^/rest/api/3/user/assignable/search$')],
];

const QUERY_KEYS = new Set(['maxResults', 'orderBy', 'issueKey', 'query', 'startAt']);

// A signed request is good for five minutes
const MAX_SKEW_SECONDS = 300;

/** Header values arrive as arrays, under whatever case the caller used. */
export function header(headers, name) {
  const wanted = name.toLowerCase();
  for (const [key, value] of Object.entries(headers ?? {})) {
    if (key.toLowerCase() === wanted) return Array.isArray(value) ? value[0] : value;
  }
  return undefined;
}

export function sign(secret, timestamp, body) {
  return crypto.createHmac('sha256', secret).update(`${timestamp}.${body}`).digest('hex');
}

/** True when the request carries a fresh signature made with the secret. */
export function verify(secret, headers, body, nowSeconds = Math.floor(Date.now() / 1000)) {
  const timestamp = Number(header(headers, 'x-taro-timestamp'));
  const signature = String(header(headers, 'x-taro-signature') ?? '');
  if (!secret || !Number.isFinite(timestamp) || Math.abs(nowSeconds - timestamp) > MAX_SKEW_SECONDS) return false;
  const expected = sign(secret, timestamp, body ?? '');
  return signature.length === expected.length && crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected));
}

/** The Jira call a request asks for, or a reason it isn't allowed. */
export function readCall(body) {
  let call;
  try {
    call = JSON.parse(body ?? '');
  } catch {
    return { error: 'The request is not JSON.' };
  }
  if (!call || call.v !== 1 || typeof call.method !== 'string' || typeof call.path !== 'string') {
    return { error: 'The request is missing its method or path.' };
  }
  const method = call.method.toUpperCase();
  if (!ALLOWED.some(([m, pattern]) => m === method && pattern.test(call.path))) {
    return { error: `Taro may not call ${method} ${call.path}.` };
  }
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(call.query ?? {})) {
    if (QUERY_KEYS.has(key) && typeof value === 'string') query.set(key, value.slice(0, 200));
  }
  const qs = query.toString();
  return {
    method,
    path: qs ? `${call.path}?${qs}` : call.path,
    body: call.body && typeof call.body === 'object' ? JSON.stringify(call.body) : undefined,
  };
}

/** A connection key: the trigger's address and the secret, in one string to paste into Taro. */
export function connectionKey(url, secret) {
  return `taro-jira-1.${Buffer.from(JSON.stringify({ u: url, s: secret })).toString('base64url')}`;
}
