// @ts-check
import { meetingCodeFromPath } from './lib/meet.js';

const $ = (id) => /** @type {any} */ (document.getElementById(id));
let code = null;

function ask(type, extra = {}) {
  return chrome.runtime.sendMessage({ type, code, ...extra });
}

function show(state) {
  if (!state) return;
  $('error').hidden = !state.error;
  $('error').textContent = state.error ?? '';

  const connected = state.connected;
  $('account-title').textContent = connected ? 'Connected' : state.expired ? 'Signed out' : 'Not connected';
  $('account-note').textContent = connected
    ? `This browser can invite Taro for ${state.workspace ?? 'your workspace'}${state.user ? ` as ${state.user}` : ''}.`
    : state.expired
      ? 'Taro signed this browser out. Connect it again to keep inviting Taro.'
      : 'Connect this browser to your Taro workspace, then invite Taro from any Google Meet call.';
  $('connect').hidden = connected;
  $('connect').textContent = state.expired ? 'Reconnect' : 'Connect this browser';
  $('disconnect').hidden = !connected;

  $('meeting').hidden = !code || !connected;
  const m = state.meeting;
  const live = m && ['pending', 'joining', 'active'].includes(m.status);
  $('meeting-status').textContent = !m
    ? 'Taro isn’t in this call yet.'
    : m.status === 'active'
      ? 'Taro is listening.'
      : live
        ? 'Taro is waiting to be admitted.'
        : m.status === 'error'
          ? (m.errorMessage ?? 'Taro couldn’t join.')
          : 'Taro left this call.';
  $('invite').disabled = !!live;

  // Never overwrite an address the person is in the middle of typing.
  if (document.activeElement !== $('app-url') && !$('app-url').dataset.dirty) $('app-url').value = state.appUrl ?? '';
  $('app-url').disabled = !!state.appUrlManaged;
  $('app-url-note').textContent = state.appUrlManaged ? 'Set by your organization.' : 'The dashboard this browser connects to.';
  $('show-button').checked = state.showButton !== false;
  $('show-button').disabled = !!state.showButtonManaged;
  // Saving is only safe once the real settings are on screen.
  $('save').disabled = false;
  $('open').href = state.appUrl ? `${state.appUrl}/dashboard` : '#';
}

async function init() {
  // Handlers first, so a quick click is never lost while the state loads.
  $('app-url').addEventListener('input', () => ($('app-url').dataset.dirty = '1'));
  $('invite').addEventListener('click', async () => {
    $('invite').disabled = true;
    $('invite').textContent = 'Sending Taro';
    show(await ask('taro.invite'));
    $('invite').textContent = 'Invite Taro';
  });
  $('connect').addEventListener('click', async () => {
    await ask('taro.connect');
    window.close();
  });
  $('disconnect').addEventListener('click', async () => show(await ask('taro.disconnect')));
  $('save').addEventListener('click', async () => {
    const update = { showButton: $('show-button').checked };
    if (!$('app-url').disabled) update.appUrl = $('app-url').value;
    delete $('app-url').dataset.dirty;
    show(await ask('taro.settings', update));
  });
  $('open').addEventListener('click', (e) => {
    e.preventDefault();
    if ($('open').href !== '#') chrome.tabs.create({ url: $('open').href });
  });

  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (tab?.url) {
    const url = new URL(tab.url);
    if (url.hostname === 'meet.google.com') code = meetingCodeFromPath(url.pathname);
  }
  show(await ask('taro.state', { refresh: true }));
}

init();
