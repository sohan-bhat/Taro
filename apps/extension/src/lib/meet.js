// @ts-check
// Google Meet room addresses look like meet.google.com/abc-defg-hij. Everything
// here is pure so it can be tested in Node and imported by the content script.

const ROOM = /^\/([a-z]{3}-[a-z]{4}-[a-z]{3})(?:\/|$)/i;
const CODE = /^[a-z]{3}-[a-z]{4}-[a-z]{3}$/;

/** The meeting code in a Meet path, lowercased, or null on any other page. */
export function meetingCodeFromPath(pathname) {
  const match = ROOM.exec(String(pathname || ''));
  return match ? match[1].toLowerCase() : null;
}

/** Rebuilds the join link from a code, so nothing from the page reaches the server unchecked. */
export function meetingUrlFromCode(code) {
  const clean = String(code || '').trim().toLowerCase();
  if (!CODE.test(clean)) throw new Error('Not a Google Meet code');
  return `https://meet.google.com/${clean}`;
}

/** Trims a Taro address to its origin, or null when it isn't an http(s) URL. */
export function originOf(value) {
  try {
    const url = new URL(String(value).trim());
    if (url.protocol !== 'https:' && url.protocol !== 'http:') return null;
    return url.origin;
  } catch {
    return null;
  }
}
