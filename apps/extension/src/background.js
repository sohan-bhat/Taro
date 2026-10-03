// @ts-check
// The extension's only network client. The content script on Meet and the
// popup ask it to act; it holds the Taro token (which page scripts can never
// read) and talks to the Taro API on the person's behalf.
import { DEFAULT_APP_URL } from './config.js';
import { meetingCodeFromPath, originOf } from './lib/meet.js';

const CONNECT_TTL_MS = 15 * 60 * 1000;

/**
 * @typedef {{ token: string, apiUrl: string, workspace?: string, user?: string, connectedAt: number }} Auth
 * @typedef {{ id: string, status: string, errorMessage?: string, lastAnswer?: string }} TrackedMeeting
 */

async function settings() {
  const managed = await chrome.storage.managed.get(['appUrl', 'showButton']).catch(() => ({}));
  const local = await chrome.storage.local.get(['appUrl', 'showButton', 'auth', 'expired']);
  const appUrl = originOf(managed.appUrl) || originOf(local.appUrl) || DEFAULT_APP_URL;
  return {
    appUrl,
    appUrlManaged: !!originOf(managed.appUrl),
    showButton: typeof managed.showButton === 'boolean' ? managed.showButton : local.showButton !== false,
    showButtonManaged: typeof managed.showButton === 'boolean',
    /** @type {Auth | null} */
    auth: local.auth ?? null,
    expired: !!local.expired,
  };
}

/** Meetings this browser is tracking, by meeting code. Cleared when the browser closes. */
async function tracked(code) {
  const key = `meeting:${code}`;
  return /** @type {TrackedMeeting | null} */ ((await chrome.storage.session.get(key))[key] ?? null);
}
async function track(code, meeting) {
  const key = `meeting:${code}`;
  if (meeting) await chrome.storage.session.set({ [key]: meeting });
  else await chrome.storage.session.remove(key);
}

class SignedOut extends Error {}

async function api(path, init = {}) {
  const { auth } = await settings();
  if (!auth) throw new SignedOut();
  const res = await fetch(`${auth.apiUrl}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${auth.token}`,
      'Content-Type': 'application/json',
      // Development servers behind ngrok answer browsers with a warning page without this.
      'ngrok-skip-browser-warning': '1',
    },
  });
  if (res.status === 401) {
    await chrome.storage.local.set({ auth: null, expired: true });
    throw new SignedOut();
  }
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(typeof body.error === 'string' ? body.error : `Taro answered ${res.status}.`);
  return body;
}

/** The slim status the pill needs, from the server's answer. */
function slim(meeting) {
  if (!meeting) return null;
  return { id: meeting._id, status: meeting.status, errorMessage: meeting.errorMessage, lastAnswer: meeting.lastAnswer };
}

async function state(code, { refresh = false } = {}) {
  const s = await settings();
  let meeting = code ? await tracked(code) : null;
  let error = null;
  if (s.auth && code && refresh) {
    try {
      const found = await api(`/api/meetings/lookup?code=${encodeURIComponent(code)}`);
      meeting = slim(found.meeting);
      await track(code, meeting);
    } catch (e) {
      if (!(e instanceof SignedOut)) error = e instanceof Error ? e.message : String(e);
    }
  }
  const after = await settings();
  return {
    connected: !!after.auth,
    expired: after.expired,
    workspace: after.auth?.workspace,
    user: after.auth?.user,
    appUrl: after.appUrl,
    appUrlManaged: after.appUrlManaged,
    showButton: after.showButton,
    showButtonManaged: after.showButtonManaged,
    meeting,
    error,
  };
}

async function invite(code) {
  try {
    const res = await api('/api/meetings', { method: 'POST', body: JSON.stringify({ meetingCode: code }) });
    await track(code, slim(res.meeting));
    return { ...(await state(code)), error: null };
  } catch (e) {
    if (e instanceof SignedOut) return state(code);
    return { ...(await state(code)), error: e instanceof Error ? e.message : String(e) };
  }
}

async function leave(code) {
  const meeting = await tracked(code);
  if (meeting) {
    try {
      const res = await api(`/api/meetings/${encodeURIComponent(meeting.id)}/leave`, {
        method: 'POST',
        body: JSON.stringify({ meetingCode: code }),
      });
      await track(code, slim(res.meeting));
    } catch (e) {
      if (!(e instanceof SignedOut)) return { ...(await state(code)), error: e instanceof Error ? e.message : String(e) };
    }
  }
  return state(code);
}

async function openConnect() {
  const { appUrl } = await settings();
  const nonce = crypto.randomUUID();
  await chrome.storage.local.set({ pendingConnect: { nonce, origin: appUrl, createdAt: Date.now() } });
  const url = new URL('/extension/connect', appUrl);
  url.searchParams.set('id', chrome.runtime.id);
  url.searchParams.set('n', nonce);
  await chrome.tabs.create({ url: url.toString() });
}

async function openInTaro(code) {
  const { appUrl } = await settings();
  const meeting = code ? await tracked(code) : null;
  const url = new URL('/dashboard', appUrl);
  if (meeting) url.searchParams.set('meeting', meeting.id);
  await chrome.tabs.create({ url: url.toString() });
}

// The content script on Meet and the popup.
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (sender.id !== chrome.runtime.id) return false;
  const fromMeet = typeof sender.url === 'string' && sender.url.startsWith('https://meet.google.com/');
  const fromExtension = typeof sender.url === 'string' && sender.url.startsWith(`chrome-extension://${chrome.runtime.id}/`);
  if (!fromMeet && !fromExtension) return false;

  // A content script may only act on the meeting it is running in.
  const code = fromMeet ? meetingCodeFromPath(new URL(/** @type {string} */ (sender.url)).pathname) : meetingCodeFromPath(`/${message?.code ?? ''}`);
  const run = async () => {
    switch (message?.type) {
      case 'taro.state':
        return state(code, { refresh: !!message.refresh });
      case 'taro.invite':
        return code ? invite(code) : state(null);
      case 'taro.leave':
        return code ? leave(code) : state(null);
      case 'taro.dismiss':
        if (code) await track(code, null);
        return state(code);
      case 'taro.connect':
        await openConnect();
        return state(code);
      case 'taro.open':
        await openInTaro(code);
        return state(code);
      case 'taro.disconnect':
        await chrome.storage.local.set({ auth: null, expired: false });
        return state(code);
      case 'taro.settings': {
        const update = {};
        if ('appUrl' in message) {
          const origin = originOf(message.appUrl);
          if (!origin) return { ...(await state(code)), error: 'Enter the address of your Taro dashboard, like https://taro.example.com.' };
          update.appUrl = origin;
        }
        if ('showButton' in message) update.showButton = !!message.showButton;
        await chrome.storage.local.set(update);
        return state(code);
      }
      default:
        return null;
    }
  };
  run().then(sendResponse, (e) => sendResponse({ error: e instanceof Error ? e.message : String(e) }));
  return true;
});

// The Taro dashboard hands over a token after the person clicks "Connect this
// browser". Chrome only lets the origins in externally_connectable send this;
// the nonce makes sure it answers a connect this browser actually started.
chrome.runtime.onMessageExternal.addListener((message, sender, sendResponse) => {
  (async () => {
    if (message?.type !== 'taro.connect') return { ok: false, error: 'Unknown request.' };
    const { pendingConnect } = await chrome.storage.local.get('pendingConnect');
    const fresh = pendingConnect && Date.now() - pendingConnect.createdAt < CONNECT_TTL_MS;
    if (!fresh || message.nonce !== pendingConnect.nonce || sender.origin !== pendingConnect.origin) {
      return { ok: false, error: 'That connection request expired. Start again from the Taro button in Google Meet.' };
    }
    const apiUrl = originOf(message.apiUrl);
    if (typeof message.token !== 'string' || !message.token || !apiUrl) return { ok: false, error: 'Taro sent an incomplete connection.' };
    await chrome.storage.local.set({
      auth: {
        token: message.token,
        apiUrl,
        workspace: typeof message.workspace === 'string' ? message.workspace.slice(0, 80) : undefined,
        user: typeof message.user === 'string' ? message.user.slice(0, 80) : undefined,
        connectedAt: Date.now(),
      },
      expired: false,
      pendingConnect: null,
    });
    return { ok: true };
  })().then(sendResponse, () => sendResponse({ ok: false, error: 'Taro could not save the connection.' }));
  return true;
});
