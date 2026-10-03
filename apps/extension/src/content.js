// The Invite Taro button inside Google Meet. It floats at the bottom left,
// above Meet's own controls, in a closed shadow root so the page can neither
// restyle it nor reach into it. It never reads captions, chat, or names: the
// only thing it takes from the page is the meeting code in the address.
(() => {
  if (window.__taroInvite) return;
  window.__taroInvite = true;

  const MARK =
    '<svg viewBox="0 0 32 42" width="12" height="16" aria-hidden="true" focusable="false">' +
    '<g fill="none" stroke="currentColor" stroke-width="2.8" stroke-linecap="round"><path d="M16 9V2"/><path d="M16 5.2L11.4 2"/><path d="M16 5.2L20.6 2"/></g>' +
    '<path fill="currentColor" fill-rule="evenodd" d="M16 8.42C21.63 8.81 28.93 16.49 28.93 25.96C28.93 34.66 22.91 41.06 16 41.06C9.09 41.06 3.07 34.66 3.07 25.96C3.07 16.49 10.37 8.81 16 8.42Z M8.9 22.7a1.7 1.7 0 0 1 3.4 0v4.6a1.7 1.7 0 0 1 -3.4 0Z M14.3 20.1a1.7 1.7 0 0 1 3.4 0v9.8a1.7 1.7 0 0 1 -3.4 0Z M19.7 22.7a1.7 1.7 0 0 1 3.4 0v4.6a1.7 1.7 0 0 1 -3.4 0Z"/></svg>';

  const STYLE = `
    :host { all: initial; }
    .wrap { position: fixed; left: 16px; bottom: 88px; z-index: 2147482000; display: flex; flex-direction: column; align-items: flex-start; gap: 8px;
      font-family: 'Taro Record', ui-sans-serif, system-ui, sans-serif; -webkit-font-smoothing: antialiased; }
    .pill { display: inline-flex; align-items: center; gap: 8px; height: 36px; padding: 0 14px 0 12px; border-radius: 999px;
      border: 1.5px solid transparent; background: #4E3564; color: #F4F0F6; font: inherit; font-size: 14px; font-weight: 600; line-height: 1;
      cursor: pointer; box-shadow: 0 6px 18px -8px rgba(0, 0, 0, 0.45); }
    .pill:hover { background: #5E4377; }
    .pill:active { background: #432C57; }
    .pill[aria-busy='true'] { cursor: progress; }
    .pill.alert { background: #FFFFFF; color: #A3244B; border-color: #A3244B; }
    .pill.alert:hover { background: #F8F5F9; }
    .pill:focus-visible { outline: 2px solid #F4F0F6; outline-offset: 2px; }
    .pill.alert:focus-visible { outline-color: #A3244B; }
    .panel { order: -1; width: 288px; box-sizing: border-box; padding: 14px 16px; border-radius: 12px; background: #FFFFFF; color: #1D1724;
      border: 1px solid #E2DBE7; box-shadow: 0 12px 32px -12px rgba(29, 23, 36, 0.38); font-size: 14px; line-height: 1.45; }
    .panel[hidden] { display: none; }
    .detail { margin: 0; color: #4A4255; }
    .actions { display: flex; flex-wrap: wrap; gap: 4px 16px; margin-top: 10px; }
    .actions button { min-height: 32px; padding: 0; border: 0; background: none; color: #4E3564; font: inherit; font-size: 14px;
      font-weight: 600; text-decoration: underline; text-underline-offset: 3px; cursor: pointer; }
    .actions button:hover { color: #5E4377; text-decoration-thickness: 2px; }
    .actions button:focus-visible { outline: 2px solid #4E3564; outline-offset: 2px; border-radius: 2px; }
    @media (forced-colors: active) { .pill, .panel { border: 1px solid CanvasText; } }
  `;



  let lib = null;
  let host = null;
  let pill = null;
  let panel = null;
  let code = null;
  let snapshot = null;
  let sending = false;
  let pollTimer = null;
  let dead = false;
  let lastView = '';
  let wrap = null;
  let anchor = null;
  let lastScan = 0;

  function send(type, extra = {}) {
    return new Promise((resolve) => {
      try {
        chrome.runtime.sendMessage({ type, ...extra }, (res) => {
          void chrome.runtime.lastError;
          resolve(res ?? null);
        });
      } catch {
        // The extension was reloaded or removed; this copy of the script is orphaned.
        dead = true;
        unmount();
        resolve(null);
      }
    });
  }

  // Chrome ignores @font-face inside shadow roots, so the faces join the document's font set instead.
  let fontsAdded = false;
  function addFonts() {
    if (fontsAdded) return;
    fontsAdded = true;
    for (const [family, file, weight] of [['Taro Record', 'fonts/SchibstedGrotesk-SemiBold.woff2', '600']]) {
      const face = new FontFace(family, `url(${chrome.runtime.getURL(file)})`, { display: 'swap', weight });
      document.fonts.add(face);
      face.load().catch(() => {});
    }
  }

  function mount() {
    if (host) return;
    addFonts();
    host = document.createElement('taro-invite');
    const root = host.attachShadow({ mode: 'closed' });
    const style = document.createElement('style');
    style.textContent = STYLE;
    wrap = document.createElement('div');
    wrap.className = 'wrap';
    pill = document.createElement('button');
    pill.type = 'button';
    pill.className = 'pill';
    pill.innerHTML = `${MARK}<span class="label"></span>`;
    panel = document.createElement('div');
    panel.className = 'panel';
    panel.hidden = true;
    panel.setAttribute('role', 'group');
    panel.setAttribute('aria-label', 'Taro');
    wrap.append(panel, pill);
    root.append(style, wrap);
    document.documentElement.append(host);

    pill.addEventListener('click', onPillClick);
    wrap.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && !panel.hidden) {
        closePanel();
        pill.focus();
      }
    });
  }

  function unmount() {
    stopPolling();
    host?.remove();
    host = pill = panel = wrap = anchor = null;
    lastView = '';
  }

  // Meet prints the meeting code at the bottom left of its control bar. When it's
  // there, the button sits right beside it; otherwise it floats in that corner.
  function findAnchor() {
    if (anchor?.isConnected) return anchor;
    anchor = null;
    const now = Date.now();
    if (!code || now - lastScan < 5000) return null;
    lastScan = now;
    const hits = document.evaluate(
      `//body//*[not(self::script or self::style)][contains(text(), '${code}')]`,
      document,
      null,
      XPathResult.ORDERED_NODE_SNAPSHOT_TYPE,
      null
    );
    for (let i = 0; i < hits.snapshotLength; i++) {
      // Measure the words themselves: the element around them may stretch across the bar.
      const text = [...hits.snapshotItem(i).childNodes].find((n) => n.nodeType === Node.TEXT_NODE && n.nodeValue.includes(code));
      const r = text && textRect(text);
      if (r && r.width > 0 && r.bottom > innerHeight - 120 && r.left < innerWidth / 3) return (anchor = text);
    }
    return null;
  }

  function textRect(node) {
    const range = document.createRange();
    range.selectNodeContents(node);
    return range.getBoundingClientRect();
  }

  function place() {
    if (!wrap || !pill) return;
    const found = findAnchor();
    const r = found ? textRect(found) : null;
    const width = pill.getBoundingClientRect().width;
    // Stay clear of Meet's centered controls; fall back to the corner when there's no room.
    if (r && r.width > 0 && r.right + 16 + width < innerWidth / 2 - 230) {
      wrap.style.left = `${Math.round(r.right + 16)}px`;
      wrap.style.bottom = `${Math.round(innerHeight - (r.top + r.height / 2) - 18)}px`;
    } else {
      wrap.style.left = '16px';
      wrap.style.bottom = '88px';
    }
  }

  function closePanel() {
    if (!panel) return;
    panel.hidden = true;
    pill?.setAttribute('aria-expanded', 'false');
  }

  function render() {
    if (!pill || !lib) return;
    const view = lib.pillView({
      connected: !!snapshot?.connected,
      expired: !!snapshot?.expired,
      sending,
      meeting: snapshot?.meeting ?? null,
      error: snapshot?.error ?? null,
    });
    schedulePolling();
    // Polling repeats the same answer most of the time; leave the DOM (and focus) alone then.
    const key = JSON.stringify(view);
    if (key === lastView) return;
    lastView = key;
    pill.querySelector('.label').textContent = view.label;
    requestAnimationFrame(place);
    pill.classList.toggle('alert', view.tone === 'alert');
    pill.setAttribute('aria-busy', view.busy ? 'true' : 'false');
    pill.disabled = view.busy;
    pill.dataset.action = view.action;
    if (view.action === 'menu') pill.setAttribute('aria-expanded', panel.hidden ? 'false' : 'true');
    else {
      pill.removeAttribute('aria-expanded');
      closePanel();
    }

    panel.replaceChildren();
    if (view.detail) {
      const p = document.createElement('p');
      p.className = 'detail';
      p.textContent = view.detail;
      panel.append(p);
    }
    if (view.menu.length) {
      const actions = document.createElement('div');
      actions.className = 'actions';
      for (const item of view.menu) {
        const b = document.createElement('button');
        b.type = 'button';
        b.textContent = item.label;
        b.addEventListener('click', (e) => onMenu(e, item.id));
        actions.append(b);
      }
      panel.append(actions);
    }
  }

  async function onPillClick(e) {
    // Only a real click by the person counts; the page can't trigger an invite.
    if (!e.isTrusted || !lib) return;
    const action = pill.dataset.action;
    if (action === 'connect') {
      snapshot = await send('taro.connect');
      render();
    } else if (action === 'invite') {
      await invite();
    } else if (action === 'menu') {
      const opening = panel.hidden;
      panel.hidden = !opening;
      pill.setAttribute('aria-expanded', opening ? 'true' : 'false');
      if (opening) panel.querySelector('button')?.focus();
    }
  }

  async function invite() {
    sending = true;
    snapshot = { ...(snapshot ?? {}), error: null };
    render();
    snapshot = await send('taro.invite');
    sending = false;
    render();
  }

  async function onMenu(e, id) {
    if (!e.isTrusted) return;
    closePanel();
    if (id === 'leave') snapshot = await send('taro.leave');
    else if (id === 'open') await send('taro.open');
    else if (id === 'retry') {
      await send('taro.dismiss');
      await invite();
      return;
    } else if (id === 'dismiss') snapshot = await send('taro.dismiss');
    render();
    pill?.focus();
  }

  async function refresh(fromServer) {
    const next = await send('taro.state', { refresh: fromServer });
    if (dead) return;
    snapshot = next;
    if (snapshot && snapshot.showButton === false) {
      unmount();
      return;
    }
    if (!host) mount();
    render();
  }

  function stopPolling() {
    if (pollTimer) clearTimeout(pollTimer);
    pollTimer = null;
  }

  // Ask the server for news only while Taro is on its way in or in the call.
  function schedulePolling() {
    stopPolling();
    const status = snapshot?.meeting?.status;
    if (!snapshot?.connected || !['pending', 'joining', 'active'].includes(status)) return;
    pollTimer = setTimeout(() => {
      if (!document.hidden) refresh(true);
      else schedulePolling();
    }, 4000);
  }

  function tick() {
    if (dead || !lib) return;
    const next = lib.meetingCodeFromPath(location.pathname);
    place();
    if (next === code) return;
    code = next;
    snapshot = null;
    if (code) refresh(true);
    else unmount();
  }

  (async () => {
    try {
      const [meet, pillLib] = await Promise.all([
        import(chrome.runtime.getURL('src/lib/meet.js')),
        import(chrome.runtime.getURL('src/lib/pill.js')),
      ]);
      lib = { meetingCodeFromPath: meet.meetingCodeFromPath, pillView: pillLib.pillView };
    } catch {
      return;
    }
    tick();
    // Meet changes rooms without reloading the page.
    setInterval(tick, 1000);
    document.addEventListener('visibilitychange', () => {
      if (!document.hidden && code) refresh(true);
    });
    window.addEventListener('resize', () => place());
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area === 'local' && ('auth' in changes || 'showButton' in changes || 'expired' in changes) && code) refresh(false);
    });
  })();
})();
