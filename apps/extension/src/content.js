// Taro's button in Google Meet: a Material 3 button in Taro's purple, with the
// Taro mark and a word or two saying what it does, at the left end of Meet's
// bottom bar in the slot Meet leaves there for extension buttons. It only ever
// takes room that is free: Meet's own items keep their size and stay in view,
// and Meet's center controls never move. Everything lives in closed shadow
// roots the page can't reach into, and only real clicks and key presses act.
// It never reads captions, chat, or names: from the page it takes only the
// meeting code in the address and where Meet's controls are.
(() => {
  if (window.__taroInvite) return;
  window.__taroInvite = true;

  // The Taro mark (apps/web/src/components/brand.tsx) on a 24px icon grid: the
  // sprout at a 2px stroke and the bars on whole pixels, so it stays crisp at 100%.
  const MARK =
    '<svg class="mark" viewBox="0 0 24 24" width="24" height="24" aria-hidden="true" focusable="false">' +
    '<path d="M12 6.08V2.5M12 4.14L9.64 2.5M12 4.14L14.36 2.5" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>' +
    '<path fill="currentColor" fill-rule="evenodd" d="M12 5.79C14.88 5.99 18.62 9.92 18.62 14.77C18.62 19.22 15.54 22.5 12 22.5C8.46 22.5 5.38 19.22 5.38 14.77C5.38 9.92 9.12 5.99 12 5.79Z' +
    'M8 13.5a1 1 0 0 1 2 0v2a1 1 0 0 1 -2 0ZM11 12a1 1 0 0 1 2 0v5a1 1 0 0 1 -2 0ZM14 13.5a1 1 0 0 1 2 0v2a1 1 0 0 1 -2 0Z"/></svg>';

  // Material Symbols (Apache 2.0), the set Meet's own icons come from.
  const symbol = (d) =>
    `<svg viewBox="0 -960 960 960" width="24" height="24" aria-hidden="true" focusable="false"><path fill="currentColor" d="${d}"/></svg>`;
  const SYMBOLS = {
    leave: symbol('M200-120q-33 0-56.5-23.5T120-200v-560q0-33 23.5-56.5T200-840h280v80H200v560h280v80H200Zm440-160-55-58 102-102H360v-80h327L585-622l55-58 200 200-200 200Z'),
    open: symbol('M200-120q-33 0-56.5-23.5T120-200v-560q0-33 23.5-56.5T200-840h280v80H200v560h560v-280h80v280q0 33-23.5 56.5T760-120H200Zm188-212-56-56 372-372H560v-80h280v280h-80v-144L388-332Z'),
  };

  // Meet's focus ring color is an inherited GM3 custom property, which `all:
  // initial` leaves alone, so inside the bar it is Meet's live one; the fallback
  // is Meet's dark value. Meet loads Google Sans and Roboto; the bundled face
  // stands in for both.
  const TOKENS = `
    --sans: 'Google Sans', 'Taro Record', Roboto, Arial, sans-serif;
    --secondary: var(--gm3-sys-color-secondary, #7fcfff);
  `;

  const STYLE = `
    :host { all: initial !important; display: inline-flex !important; vertical-align: top !important; flex: none !important; ${TOKENS} }
    /* Room around the button for Meet's focus ring, which Meet's left section would otherwise clip. */
    .item { display: flex; align-items: center; margin-block: 5px calc(5px + var(--mb, 0px)); margin-inline: var(--lead, 0px) var(--gap, 0px); }
    .item.floating { position: fixed; inset-inline-start: 16px; bottom: 88px; z-index: 2147482000; margin: 0; }

    /* A Material 3 tonal button in Taro's purple: resting, a brighter tone while
       Taro is on its way in, and a light one, unmistakably on, while it listens.
       Every pairing clears 4.5:1, hover and press included. */
    .control { --container: #4e3564; --content: #f4f0f6; position: relative; display: inline-flex; align-items: center; justify-content: center;
      gap: 8px; box-sizing: border-box; height: var(--h, 48px); min-width: var(--h, 48px); margin: 0; padding-block: 0;
      padding-inline: 16px 20px; border: 0; border-radius: calc(var(--h, 48px) / 2); background: var(--container); color: var(--content);
      font: 500 14px/20px var(--sans); letter-spacing: 0.1px; white-space: nowrap; cursor: pointer; outline: none;
      -webkit-tap-highlight-color: transparent; user-select: none; }
    .control.progress { --container: #6e5289; --content: #f4f0f6; }
    .control.on { --container: #dcc6f2; --content: #1d1724; }
    .compact .control { width: var(--h, 48px); padding: 0; }
    .compact .label { display: none; }
    .floating .control { box-shadow: 0 1px 3px rgba(0, 0, 0, 0.3), 0 4px 8px 3px rgba(0, 0, 0, 0.15); }
    .mark { flex: none; display: block; width: 24px; height: 24px; pointer-events: none; }
    .label { pointer-events: none; }
    /* Material 3 state layers, in the content color. */
    .control::before { content: ''; position: absolute; inset: 0; border-radius: inherit; background: var(--content); opacity: 0;
      pointer-events: none; transition: opacity 75ms linear; }
    .control:hover::before { opacity: 0.08; }
    .control:focus-visible::before, .control:active::before { opacity: 0.1; }
    .control[aria-disabled='true'] { cursor: default; }
    /* Meet's focus ring: 3px of its secondary color, 2px out, flaring once as it appears. */
    .control::after { content: ''; position: absolute; inset: -2px; display: none; border-radius: calc(var(--h, 48px) / 2 + 2px);
      pointer-events: none; box-shadow: 0 0 0 3px var(--secondary); }
    .control:focus-visible::after { display: block; animation: ring-grow 150ms cubic-bezier(0.2, 0, 0, 1), ring-settle 450ms cubic-bezier(0.2, 0, 0, 1) 150ms; }
    @keyframes ring-grow { from { box-shadow: 0 0 0 0 var(--secondary); } to { box-shadow: 0 0 0 8px var(--secondary); } }
    @keyframes ring-settle { from { box-shadow: 0 0 0 8px var(--secondary); } }
    /* Like Meet's own buttons, the shape firms up while pressed and colors step between states. */
    @media not (prefers-reduced-motion) {
      .control { transition: border-radius 200ms steps(6, jump-none), background-color 200ms steps(6, jump-none), color 200ms steps(6, jump-none); }
      .control:active { border-radius: 8px; }
      .control:active::after { border-radius: 10px; }
    }
    @media (prefers-reduced-motion) { .control:focus-visible::after { animation: none; } }

    /* Meet's tooltip: always dark, whatever Meet's theme. It grows in from 80% on the button's side and fades out. */
    .tip { position: fixed; inset: auto; margin: 0; box-sizing: border-box; min-width: 40px; max-width: 200px; min-height: 22px; max-height: 40vh;
      padding: 4px 8px; border: 0; border-radius: 4px; overflow: hidden; overflow-wrap: anywhere; background: #303030; color: #e3e3e3;
      font: 400 12px/16px var(--sans); letter-spacing: 0.1px; text-align: center; opacity: 0; transform: scale(0.8);
      transition: opacity 75ms cubic-bezier(0.4, 0, 1, 1); }
    .tip.wrapped { text-align: start; }
    .tip.shown { opacity: 1; transform: scale(1); transition: opacity 150ms cubic-bezier(0, 0, 0.2, 1), transform 150ms cubic-bezier(0, 0, 0.2, 1); }
    .tip.leaving { transform: scale(1); }

    /* Meet's menus follow its Appearance theme: light unless Meet is dark. */
    .menu { --menu-bg: #f0f4f9; --menu-text: #1f1f1f; --menu-icon: #444746; --menu-rule: #e1e3e1; --menu-ring: #00639b;
      position: fixed; inset: auto; margin: 0; box-sizing: border-box; min-width: 112px; max-width: min(320px, calc(100vw - 32px)); padding: 4px;
      border: 0; border-radius: 12px; background: var(--menu-bg); color: var(--menu-text); font: 500 14px/20px var(--sans); letter-spacing: 0;
      box-shadow: 0 1px 2px rgba(0, 0, 0, 0.3), 0 2px 6px 2px rgba(0, 0, 0, 0.15); overflow: visible; outline: none;
      opacity: 0; transform: scaleY(0.8); transform-origin: left bottom; transition: opacity 75ms linear; }
    .menu.dark { --menu-bg: #1e1f20; --menu-text: #e3e3e3; --menu-icon: #c4c7c5; --menu-rule: #444746; --menu-ring: #7fcfff; }
    .menu.end { transform-origin: right bottom; }
    .menu.shown { opacity: 1; transform: none; transition: opacity 30ms linear, transform 200ms cubic-bezier(0.38, 1.21, 0.22, 1); }
    .answer { margin: 0; padding: 8px 12px; max-width: 288px; color: var(--menu-icon); font-weight: 400; overflow-wrap: anywhere; }
    .answer[hidden], .rule[hidden] { display: none; }
    .rule { height: 1px; margin: 8px 0; background: var(--menu-rule); }
    .entry { position: relative; display: flex; align-items: center; gap: 16px; box-sizing: border-box; width: 100%; min-height: 48px; margin: 0;
      padding: 8px 12px; border: 0; border-radius: 4px; background: transparent; color: inherit; font: inherit; letter-spacing: inherit;
      text-align: start; white-space: nowrap; cursor: pointer; outline: none; }
    .entry:first-of-type { border-start-start-radius: 12px; border-start-end-radius: 12px; }
    .entry:last-of-type { border-end-start-radius: 12px; border-end-end-radius: 12px; }
    .entry:focus-visible { border-radius: 8px; outline: 3px solid var(--menu-ring); outline-offset: -3px; }
    .entry::before { content: ''; position: absolute; inset: 0; border-radius: inherit; background: currentColor; opacity: 0; pointer-events: none; }
    .entry:hover::before { opacity: 0.08; }
    .entry:focus-visible::before, .entry:active::before { opacity: 0.1; }
    .entry svg { flex: none; width: 24px; height: 24px; color: var(--menu-icon); }

    @media (forced-colors: active) {
      .control { border: 1px solid ButtonText; }
      .control.on { background: Highlight; color: HighlightText; }
      .control:focus-visible::after { box-shadow: none; outline: 3px solid CanvasText; }
      .tip, .menu { border: 1px solid CanvasText; }
    }
  `;

  // Meet's in-call snackbar: bottom left above the bar, dark gray unless Meet's
  // Appearance theme is dark, where it turns white.
  const NOTICE_STYLE = `
    :host { all: initial !important; ${TOKENS} }
    .stack { position: fixed; inset-inline-start: 24px; bottom: 112px; z-index: 2002; display: flex; flex-direction: column; align-items: flex-start;
      max-width: calc(100vw - 48px); pointer-events: none; }
    .snack { --snack-bg: #3c4043; --snack-text: #e8eaed; display: flex; align-items: center; box-sizing: border-box; min-width: min(344px, calc(100vw - 48px));
      max-width: 672px; min-height: 48px; border-radius: 4px; background: var(--snack-bg); color: var(--snack-text);
      font: 400 14px/20px Roboto, var(--sans); letter-spacing: 0.25px; pointer-events: auto;
      box-shadow: 0 3px 5px -1px rgba(0, 0, 0, 0.2), 0 6px 10px 0 rgba(0, 0, 0, 0.14), 0 1px 18px 0 rgba(0, 0, 0, 0.12);
      opacity: 0; transform: scale(0.8); transition: opacity 75ms cubic-bezier(0.4, 0, 1, 1); }
    .snack.dark { --snack-bg: #fff; --snack-text: #3c4043; }
    .snack.shown { opacity: 1; transform: none; transition: opacity 150ms cubic-bezier(0, 0, 0.2, 1), transform 150ms cubic-bezier(0, 0, 0.2, 1); }
    .snack.leaving { transform: none; }
    .text { flex: 1; padding: 14px 8px 14px 16px; }
    /* Meet's snackbar action: a text button in its accent. */
    .action { --action: #8ab4f8; position: relative; flex: none; min-width: 64px; height: 36px; margin: 6px 8px 6px 0; padding: 0 8px; border: 0;
      border-radius: 4px; background: transparent; color: var(--action); font: 500 14px/20px var(--sans); letter-spacing: 0.25px;
      cursor: pointer; outline: none; }
    .action:hover { --action: #aecbfa; }
    .action:focus-visible { --action: #aecbfa; outline: 3px solid var(--secondary); outline-offset: 0; }
    .snack.dark .action { --action: #1a73e8; }
    .snack.dark .action:focus-visible { outline-color: #00639b; }
    .action::before { content: ''; position: absolute; inset: 0; border-radius: inherit; background: currentColor; opacity: 0; }
    .action:hover::before { opacity: 0.08; }
    .action:active::before { opacity: 0.12; }
    .live { position: fixed; width: 1px; height: 1px; overflow: hidden; clip-path: inset(50%); white-space: nowrap; }
    @media (forced-colors: active) { .snack { border: 1px solid CanvasText; } }
    @media (prefers-reduced-motion) { .snack { transition: none; transform: none; } }
  `;

  // Meet's tooltip timing: shows after half a second, lingers 600ms after the pointer leaves.
  const TIP_DELAY_MS = 500;
  const TIP_LINGER_MS = 600;

  let lib = null;
  let code = null;
  let snapshot = null;
  let sending = false;
  let pollTimer = null;
  let dead = false;
  let lastKey = '';
  /** @type {{ label: string, tip: string, action: string, look: string, answer?: string, menu: Array<{ id: string, label: string }> } | null} */
  let view = null;

  let host = null;
  let item = null;
  let button = null;
  let words = null;
  let about = null;
  let tip = null;
  let menu = null;
  let tipTimer = null;
  let menuTimer = null;

  let noticeHost = null;
  let noticeStack = null;
  let noticeLive = null;
  let noticeTimer = null;
  const announced = new Set();

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

  // Chrome ignores @font-face inside shadow roots, so the fallback face joins the
  // document's font set. It only downloads if Meet's Google Sans is missing.
  let fontsAdded = false;
  function addFonts() {
    if (fontsAdded) return;
    fontsAdded = true;
    try {
      const url = chrome.runtime.getURL('fonts/SchibstedGrotesk-SemiBold.woff2');
      document.fonts.add(new FontFace('Taro Record', `url(${url})`, { display: 'swap', weight: '600' }));
    } catch {}
  }

  // ---------------------------------------------------------------- the button

  function mount() {
    if (host) return;
    addFonts();
    host = document.createElement('taro-invite');
    const root = host.attachShadow({ mode: 'closed' });
    const style = document.createElement('style');
    style.textContent = STYLE;
    item = document.createElement('div');
    item.className = 'item wide';
    button = document.createElement('button');
    button.type = 'button';
    button.className = 'control rest';
    button.innerHTML = MARK;
    words = document.createElement('span');
    words.className = 'label';
    button.append(words);
    // The longer explanation, for screen readers, where it adds to the words on the button.
    about = document.createElement('span');
    about.id = 'about';
    about.hidden = true;
    tip = document.createElement('div');
    tip.className = 'tip';
    tip.setAttribute('popover', 'manual');
    // The tooltip repeats the button's name or description, so screen readers hear it once.
    tip.setAttribute('aria-hidden', 'true');
    menu = document.createElement('div');
    menu.className = 'menu';
    menu.setAttribute('popover', 'manual');
    menu.setAttribute('role', 'menu');
    menu.setAttribute('aria-label', 'Taro');
    menu.tabIndex = -1;
    item.append(button, about, tip, menu);
    root.append(style, item);

    button.addEventListener('click', onButtonClick);
    button.addEventListener('keydown', onButtonKey);
    button.addEventListener('pointerenter', (e) => e.pointerType !== 'touch' && scheduleTip());
    button.addEventListener('pointerleave', () => hideTip(true));
    button.addEventListener('pointerdown', () => hideTip());
    button.addEventListener('focus', () => button.matches(':focus-visible') && scheduleTip());
    button.addEventListener('blur', () => hideTip());
    tip.addEventListener('pointerenter', () => clearTimeout(tipTimer));
    tip.addEventListener('pointerleave', () => hideTip(true));
    menu.addEventListener('keydown', onMenuKey);
    menu.addEventListener('focusout', (e) => {
      if (!(e.relatedTarget instanceof Node) || !item.contains(e.relatedTarget)) closeMenu(false);
    });
    document.addEventListener('pointerdown', onOutsidePointer, true);
    window.addEventListener('blur', onWindowBlur);
    window.addEventListener('scroll', onScroll, true);
    window.addEventListener('resize', onResize);
    document.fonts?.addEventListener('loadingdone', onFonts);

    place();
    watchBar();
  }

  function unmount() {
    stopPolling();
    stopWatching();
    clearTimeout(tipTimer);
    clearTimeout(menuTimer);
    clearTimeout(resizeTimer);
    document.removeEventListener('pointerdown', onOutsidePointer, true);
    window.removeEventListener('blur', onWindowBlur);
    window.removeEventListener('scroll', onScroll, true);
    window.removeEventListener('resize', onResize);
    document.fonts?.removeEventListener('loadingdone', onFonts);
    host?.remove();
    host = item = button = words = about = tip = menu = null;
    slot = placedBefore = null;
    tried = [];
    layoutKey = '';
    missingSince = 0;
    lastKey = '';
    view = null;
    dismissNotice();
    noticeHost?.remove();
    noticeHost = noticeStack = noticeLive = null;
  }

  function render() {
    if (!button || !lib) return;
    const next = lib.controlView({
      connected: !!snapshot?.connected,
      expired: !!snapshot?.expired,
      sending,
      meeting: snapshot?.meeting ?? null,
      error: snapshot?.error ?? null,
    });
    schedulePolling();
    // Polling repeats the same answer most of the time; leave the DOM (and focus) alone then.
    const key = JSON.stringify(next);
    if (key === lastKey) return;
    const relabeled = next.label !== view?.label;
    lastKey = key;
    view = next;
    words.textContent = next.label;
    about.textContent = next.tip;
    nameButton();
    button.className = `control ${next.look}`;
    if (next.action === 'none') button.setAttribute('aria-disabled', 'true');
    else button.removeAttribute('aria-disabled');
    if (next.action === 'menu') {
      button.setAttribute('aria-haspopup', 'menu');
      button.setAttribute('aria-expanded', menuOpen() ? 'true' : 'false');
    } else {
      button.removeAttribute('aria-haspopup');
      button.removeAttribute('aria-expanded');
      closeMenu(false);
    }
    tip.textContent = next.tip;
    if (!tipUseful()) hideTip();
    else if (tipShown()) positionTip();
    buildMenu(next);
    // New words may no longer fit beside Meet's items, or may fit where the old ones didn't.
    if (relabeled) place();
  }

  /** Its name is the words on it; with only the mark showing, the tooltip's words are. */
  function nameButton() {
    if (!view) return;
    if (item.classList.contains('compact')) {
      button.setAttribute('aria-label', view.tip);
      button.removeAttribute('aria-describedby');
    } else {
      button.removeAttribute('aria-label');
      if (view.tip !== view.label) button.setAttribute('aria-describedby', 'about');
      else button.removeAttribute('aria-describedby');
    }
  }

  // Updated in place rather than rebuilt, so a new answer arriving while the
  // menu is open never pulls focus out from under the person.
  function buildMenu(v) {
    let answer = menu.querySelector('.answer');
    if (!answer) {
      answer = document.createElement('p');
      answer.className = 'answer';
      answer.id = 'answer';
      const rule = document.createElement('div');
      rule.className = 'rule';
      rule.setAttribute('role', 'separator');
      menu.append(answer, rule);
    }
    answer.textContent = v.answer ?? '';
    answer.hidden = answer.nextElementSibling.hidden = !v.answer;
    if (v.answer) menu.setAttribute('aria-describedby', 'answer');
    else menu.removeAttribute('aria-describedby');
    const ids = v.menu.map((e) => e.id).join();
    if (menu.dataset.ids !== ids) {
      menu.dataset.ids = ids;
      for (const old of menu.querySelectorAll('.entry')) old.remove();
      for (const entry of v.menu) {
        const b = document.createElement('button');
        b.type = 'button';
        b.className = 'entry';
        b.setAttribute('role', 'menuitem');
        b.tabIndex = -1;
        b.innerHTML = SYMBOLS[entry.id] ?? '';
        const label = document.createElement('span');
        label.textContent = entry.label;
        b.append(label);
        b.addEventListener('click', (e) => onMenuItem(e, entry.id));
        menu.append(b);
      }
    }
    if (menuOpen()) positionMenu();
  }

  // ---------------------------------------------------------------- tooltip

  // Meet's own timing: half a second's wait, then it stays while the pointer is
  // on the button or the tooltip and for 600ms after it leaves both. Keyboard
  // focus shows it too. A click, Escape, scrolling, or leaving the window hides it.
  function tipShown() {
    return !!tip?.classList.contains('shown');
  }

  // The words on the button speak for themselves; the tooltip appears when it says more, or when only the mark shows.
  function tipUseful() {
    return !!view && (item.classList.contains('compact') || view.tip !== view.label);
  }

  function scheduleTip() {
    clearTimeout(tipTimer);
    // Moving over from one of Meet's buttons whose tooltip is up, it shows at once, as Meet's do.
    tipTimer = setTimeout(showTip, tipShown() || meetTipUp() ? 0 : TIP_DELAY_MS);
  }

  function meetTipUp() {
    try {
      return [...document.querySelectorAll('[id$="-visible-label"]')].some(shown);
    } catch {
      return false;
    }
  }

  function showTip() {
    clearTimeout(tipTimer);
    if (!tip || !host?.isConnected || menuOpen() || !tipUseful()) return;
    try {
      if (!tip.matches(':popover-open')) tip.showPopover();
    } catch {
      return;
    }
    tip.classList.remove('leaving');
    positionTip();
    requestAnimationFrame(() => tip?.classList.add('shown'));
  }

  /** Hides the tooltip, after Meet's 600ms linger when the pointer merely left. */
  function hideTip(linger = false) {
    clearTimeout(tipTimer);
    if (!tip) return;
    if (linger === true && tipShown()) {
      tipTimer = setTimeout(() => hideTip(), TIP_LINGER_MS);
      return;
    }
    if (!tipShown()) return closeTip();
    tip.classList.remove('shown');
    tip.classList.add('leaving');
    tipTimer = setTimeout(closeTip, 75);
  }

  function closeTip() {
    tip?.classList.remove('shown', 'leaving');
    try {
      if (tip?.matches(':popover-open')) tip.hidePopover();
    } catch {}
  }

  // Centered 4px above the button; else lined up with its start or end edge, kept
  // 8px inside the window, and below the button only when there is no room above.
  function positionTip() {
    const r = button.getBoundingClientRect();
    // Measured from the window's left edge, where its natural width has room, and
    // by layout size rather than the rectangle, since it grows in from 80%.
    tip.style.left = tip.style.top = '0px';
    const t = { width: tip.offsetWidth, height: tip.offsetHeight };
    tip.classList.toggle('wrapped', t.height > 24);
    const fits = (x) => x >= 8 && x + t.width <= innerWidth - 8;
    const centered = r.left + r.width / 2 - t.width / 2;
    const left = [centered, r.left, r.right - t.width].find(fits) ?? Math.min(Math.max(8, centered), innerWidth - 8 - t.width);
    const above = r.top - 4 - t.height;
    tip.style.left = `${Math.round(left)}px`;
    tip.style.top = `${Math.round(above >= 8 ? above : r.bottom + 4)}px`;
    tip.style.transformOrigin = `${Math.round(r.left + r.width / 2 - left)}px ${above >= 8 ? 'bottom' : 'top'}`;
  }

  // ---------------------------------------------------------------- menu

  // Meet's own menus follow its Appearance theme, which it marks with color-scheme.
  function pageDark() {
    try {
      return [document.documentElement, document.body].some((el) => el && /\bdark\b/.test(getComputedStyle(el).colorScheme));
    } catch {
      return false;
    }
  }

  function menuOpen() {
    return !!menu?.classList.contains('shown');
  }

  /**
   * Opens like Meet's: from the keyboard, onto its first item (or its last, for
   * the up arrow); from a click, onto the menu itself with nothing highlighted.
   * @param {'first' | 'last' | 'menu'} focus
   */
  function openMenu(focus) {
    if (!menu || !host?.isConnected) return;
    hideTip();
    clearTimeout(menuTimer);
    try {
      if (!menu.matches(':popover-open')) menu.showPopover();
    } catch {
      return;
    }
    menu.classList.toggle('dark', pageDark());
    button.setAttribute('aria-expanded', 'true');
    positionMenu();
    requestAnimationFrame(() => menu?.classList.add('shown'));
    const entries = menuEntries();
    /** @type {HTMLElement | undefined} */ (focus === 'menu' ? menu : focus === 'last' ? entries.at(-1) : entries[0])?.focus();
  }

  function closeMenu(refocus) {
    if (!menuOpen()) return;
    menu.classList.remove('shown');
    button?.setAttribute('aria-expanded', 'false');
    if (refocus) button?.focus();
    // Fades out over 75ms, then leaves the top layer.
    clearTimeout(menuTimer);
    menuTimer = setTimeout(() => {
      try {
        if (!menuOpen() && menu?.matches(':popover-open')) menu.hidePopover();
      } catch {}
    }, 75);
  }

  function menuEntries() {
    return /** @type {HTMLElement[]} */ ([...menu.querySelectorAll('[role="menuitem"]')]);
  }

  // Like Meet's: 12px above the button, lined up with its start edge, or its end
  // edge when that would run off the window; below it only when there is no room above.
  function positionMenu() {
    const r = button.getBoundingClientRect();
    // Measured from the window's left edge, where its natural width has room.
    menu.style.left = menu.style.top = '0px';
    const m = { width: menu.offsetWidth, height: menu.offsetHeight };
    const end = r.left + m.width > innerWidth - 48;
    const left = Math.min(Math.max(8, end ? r.right - m.width : r.left), innerWidth - 8 - m.width);
    const above = r.top - 12 - m.height;
    menu.classList.toggle('end', end);
    menu.style.left = `${Math.round(left)}px`;
    menu.style.top = `${Math.round(above >= 8 ? above : Math.min(r.bottom + 12, innerHeight - 8 - m.height))}px`;
  }

  function onMenuKey(e) {
    if (!e.isTrusted) return;
    const entries = menuEntries();
    const at = entries.indexOf(/** @type {HTMLElement} */ (menu.querySelector(':focus')));
    let next = null;
    // Like Meet's menus, focus stops at the ends rather than wrapping around.
    if (e.key === 'ArrowDown') next = at < 0 ? entries[0] : entries[Math.min(at + 1, entries.length - 1)];
    else if (e.key === 'ArrowUp') next = at < 0 ? entries.at(-1) : entries[Math.max(at - 1, 0)];
    else if (e.key === 'Home') next = entries[0];
    else if (e.key === 'End') next = entries.at(-1);
    else if (e.key === 'Escape') closeMenu(true);
    else if (e.key === 'Tab') {
      // Tab leaves the menu for the control after the button and Shift+Tab for the
      // button itself, the way a menu does. Closing the menu hands focus back to the
      // button first, so the move onward is done here.
      closeMenu(true);
      if (!e.shiftKey) focusAfterButton();
    } else return;
    // Meet listens for keys on the whole page; these ones were Taro's.
    e.preventDefault();
    e.stopPropagation();
    next?.focus();
  }

  function focusAfterButton() {
    for (const el of document.querySelectorAll('button, a[href], input, select, textarea, [tabindex]')) {
      if (!(host.compareDocumentPosition(el) & Node.DOCUMENT_POSITION_FOLLOWING) || el.tabIndex < 0 || el.matches(':disabled') || !shown(el)) continue;
      el.focus();
      return;
    }
  }

  function onOutsidePointer(e) {
    const inside = e.composedPath().includes(host);
    if (!inside) hideTip();
    if (menuOpen() && !inside) closeMenu(false);
  }

  function onWindowBlur() {
    hideTip();
    closeMenu(false);
  }

  // ---------------------------------------------------------------- notices

  function notice(text) {
    if (!text) return;
    if (!noticeHost) {
      noticeHost = document.createElement('taro-notice');
      const root = noticeHost.attachShadow({ mode: 'closed' });
      const style = document.createElement('style');
      style.textContent = NOTICE_STYLE;
      noticeStack = document.createElement('div');
      noticeStack.className = 'stack';
      // Screen readers hear the words once, politely, without the Dismiss button's name.
      noticeLive = document.createElement('div');
      noticeLive.className = 'live';
      noticeLive.setAttribute('role', 'status');
      root.append(style, noticeStack, noticeLive);
    }
    if (!noticeHost.isConnected) document.documentElement.append(noticeHost);
    liftNotices();
    // One at a time: a newer notice replaces the one on screen.
    clearTimeout(noticeTimer);
    const kind = lib.noticeKind(text);
    const snack = document.createElement('div');
    snack.className = pageDark() ? 'snack dark' : 'snack';
    const line = document.createElement('div');
    line.className = 'text';
    line.textContent = text;
    snack.append(line);
    if (kind.dismiss) {
      const dismiss = document.createElement('button');
      dismiss.type = 'button';
      dismiss.className = 'action';
      dismiss.textContent = 'Dismiss';
      dismiss.addEventListener('click', (e) => e.isTrusted && dismissNotice());
      snack.append(dismiss);
    }
    noticeStack.replaceChildren(snack);
    requestAnimationFrame(() => snack.classList.add('shown'));
    // Like Meet's, the words reach the live region just after the notice appears, so they are read.
    noticeLive.textContent = '';
    setTimeout(() => noticeLive && (noticeLive.textContent = text), 150);
    // It stays while the pointer or focus is on it, so nobody loses it mid-read.
    const later = () => {
      clearTimeout(noticeTimer);
      noticeTimer = setTimeout(dismissNotice, kind.ms);
    };
    let returnTo = null;
    snack.addEventListener('pointerenter', () => clearTimeout(noticeTimer));
    snack.addEventListener('pointerleave', later);
    snack.addEventListener('focusin', (e) => {
      clearTimeout(noticeTimer);
      if (!returnTo && e.relatedTarget instanceof HTMLElement) returnTo = e.relatedTarget;
    });
    snack.addEventListener('focusout', later);
    snack.addEventListener('keydown', (e) => {
      if (!e.isTrusted || e.key !== 'Escape') return;
      e.stopPropagation();
      dismissNotice();
      returnTo?.focus();
    });
    // The clock starts once it has finished appearing.
    noticeTimer = setTimeout(later, 150);
  }

  function dismissNotice() {
    clearTimeout(noticeTimer);
    const snack = noticeStack?.firstElementChild;
    if (!snack) return;
    snack.classList.remove('shown');
    snack.classList.add('leaving');
    setTimeout(() => snack.remove(), 75);
  }

  // Notices share the bottom left with the floating button, so they sit above it.
  function liftNotices() {
    if (!noticeStack) return;
    const floating = item?.classList.contains('floating');
    noticeStack.style.bottom = floating ? `${Math.round(innerHeight - item.getBoundingClientRect().top + 8)}px` : '';
  }

  // ---------------------------------------------------------------- placement

  // Meet renders an empty #browser-extension-start-buttons at the left end of
  // its bottom bar and #browser-extension-end-buttons just before its Chat and
  // Meeting tools group, says in the page that extensions may put buttons
  // there, and leaves their contents alone when it redraws. Taro takes the
  // start: the left end of the bar, where the eye starts and nothing of Meet's
  // competes. Meet's fixed items never shrink and its center controls never
  // move; a field Meet sizes to fit, like Ask Gemini, may give up width down to
  // what keeps it whole. Where its words still don't fit it shows just the mark,
  // then moves to the end slot, and with no bar at all it floats at the bottom left.
  const START = 'browser-extension-start-buttons';
  const END = 'browser-extension-end-buttons';
  const PLANS = /** @type {const} */ ([
    [START, 'wide'],
    [START, 'compact'],
    [END, 'wide'],
    [END, 'compact'],
  ]);
  const PANEL_BUTTONS = 'button[aria-controls][data-panel-id], [role="button"][aria-controls][data-panel-id]';
  const FIT = ['--h', '--mb', '--gap', '--lead'];

  let slot = null;
  let placedBefore = null;
  let tried = [];
  let layoutKey = '';
  let observer = null;
  let checkTimer = null;
  let resizeTimer = null;
  let lastSearch = 0;
  let missingSince = 0;
  let reinserts = [];
  let pausedUntil = 0;

  function shown(el) {
    if (!el) return false;
    if (typeof el.checkVisibility === 'function' && !el.checkVisibility()) return false;
    const r = el.getBoundingClientRect();
    return r.width > 0 && r.height > 0;
  }

  // A part of the bar with nothing in it yet has no height, only width.
  function findSlot(id) {
    for (const s of document.querySelectorAll(`[id="${id}"]`)) {
      const section = s.parentElement;
      if (section && (typeof section.checkVisibility !== 'function' || section.checkVisibility()) && section.getBoundingClientRect().width > 0) return s;
    }
    return null;
  }

  /** Meet's own items in a slot's part of the bar, and other extensions' buttons in the slot. */
  function itemsBeside(s) {
    return [...s.parentElement.children, ...s.children].filter((el) => el !== s && el !== host && shown(el));
  }

  // A field Meet sizes to fit its part of the bar, like Ask Gemini: Meet lets it
  // shrink, and it holds a text box. Everything else of Meet's is fixed.
  const TEXT_BOX = 'input:not([type="hidden"]), textarea, [contenteditable=""], [contenteditable="true"], [role="textbox"], [role="combobox"], [role="searchbox"]';
  function isField(el) {
    return parseFloat(getComputedStyle(el).flexShrink) > 0 && !!el.querySelector(TEXT_BOX);
  }

  /**
   * How narrow a field may get: wide enough that its icon, its placeholder, and
   * its send button stay whole, and never under 200px. Where Meet already shows
   * it narrower than that, it keeps the width Meet gave it.
   */
  let ruler = null;
  function fieldFloor(el, width) {
    let need = 0;
    const box = el.querySelector(TEXT_BOX);
    const words = box?.getAttribute('placeholder') || box?.getAttribute('aria-placeholder') || box?.getAttribute('data-placeholder') || '';
    if (box && words) {
      const cs = getComputedStyle(box);
      ruler ??= document.createElement('canvas').getContext('2d');
      ruler.font = `${cs.fontStyle} ${cs.fontWeight} ${cs.fontSize} ${cs.fontFamily}`;
      const text = ruler.measureText(words).width + (parseFloat(cs.letterSpacing) || 0) * words.length;
      const r = box.getBoundingClientRect();
      const inner = r.width - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight) - parseFloat(cs.borderLeftWidth) - parseFloat(cs.borderRightWidth);
      need = Math.ceil(width - inner + text);
    }
    return Math.min(width, Math.max(200, need));
  }

  /** Where Meet's center controls are, to check they never move. */
  function centerKey() {
    const region = document.getElementById('browser-extension-center-buttons')?.closest('[role="region"]');
    const buttons = region ? [...region.querySelectorAll('button')].filter(shown) : [];
    return buttons.map((b) => Math.round(b.getBoundingClientRect().left * 2) / 2).join();
  }

  /** Meet's bar without Taro: each item with the narrowest it may become, and where the center controls are. */
  function measure(s) {
    const items = itemsBeside(s).map((el) => {
      const r = el.getBoundingClientRect();
      return /** @type {const} */ ([el, r, isField(el) ? fieldFloor(el, r.width) : r.width]);
    });
    return { box: s.parentElement.getBoundingClientRect(), items, center: centerKey() };
  }

  /** Whether the button, as it now stands in slot s, leaves Meet's bar whole. */
  function fits(s, before) {
    const box = s.parentElement.getBoundingClientRect();
    const inside = (r) => r.left >= box.left - 0.5 && r.right <= box.right + 0.5;
    const own = item.getBoundingClientRect();
    if (!inside(own) || own.left < 0 || own.right > innerWidth || centerKey() !== before.center) return false;
    // Nothing of Meet's may shrink past its floor, be cut off, or be pushed further out of the window.
    return before.items.every(([el, was, floor]) => {
      const r = el.getBoundingClientRect();
      return r.width >= floor - 0.5 && inside(r) && r.right <= Math.max(was.right, innerWidth) + 0.5 && r.left >= Math.min(was.left, 0) - 0.5;
    });
  }

  /**
   * What the bar looked like: placement is worked out again when this changes.
   * Fields count by being there, not by their width, which Taro itself changes.
   */
  function currentLayout() {
    const parts = [innerWidth, innerHeight];
    for (const id of [START, END]) {
      const s = findSlot(id);
      const items = s ? itemsBeside(s).map((el) => (isField(el) ? 'field' : Math.round(el.getBoundingClientRect().width))) : [];
      parts.push(s ? [Math.round(s.parentElement.getBoundingClientRect().width), ...items].join('/') : '-');
    }
    return parts.join(',');
  }

  /**
   * Sizes the button like Meet's items beside it: as tall as a control-sized
   * neighbor (the Ask Gemini field) or else Meet's own buttons, centered on the
   * same line, with Meet's spacing.
   */
  function sizeFor(s) {
    const section = s.parentElement;
    const box = section.getBoundingClientRect();
    const peers = itemsBeside(s).map((el) => el.getBoundingClientRect()).filter((r) => r.height >= 32 && r.height <= 64);
    const control = (s.id === END ? section.querySelector(PANEL_BUTTONS) : null) ??
      [...(document.getElementById('browser-extension-center-buttons')?.closest('[role="region"]')?.querySelectorAll('button') ?? [])].find(shown);
    const ref = (s.id === START ? peers.sort((a, b) => b.height - a.height)[0] : null) ?? control?.getBoundingClientRect();
    const height = ref ? Math.min(Math.max(Math.round(ref.height), 36), 56) : 48;
    const lift = ref ? Math.round(2 * (box.top + box.height / 2 - (ref.top + ref.height / 2))) : 0;
    item.style.setProperty('--h', `${height}px`);
    item.style.setProperty('--mb', `${Math.min(Math.max(lift, 0), 16)}px`);
    // 8px from the next item, Meet's own spacing in the bar, counting any margin it already has.
    let next = s.nextElementSibling;
    while (next && !shown(next)) next = next.nextElementSibling;
    const already = next ? parseFloat(getComputedStyle(next).marginInlineStart) || 0 : 0;
    item.style.setProperty('--gap', `${Math.max(0, 8 - already)}px`);
    item.style.setProperty('--lead', s.id === START ? '5px' : '0px');
  }

  function setForm(form) {
    item.classList.remove('wide', 'compact', 'floating');
    item.classList.add(form);
    nameButton();
  }

  function inSlot() {
    return !!slot?.isConnected && host?.parentNode === slot && !!host?.isConnected;
  }

  // Moving the button would pull focus or an open menu out from under the person.
  function busy() {
    return !!host?.isConnected && (host.matches(':focus-within') || menuOpen());
  }

  function place() {
    if (!host || dead) return;
    lastSearch = Date.now();
    try {
      const layout = currentLayout();
      // Same bar, new words: try this spot's two forms where the button stands,
      // without moving it. From the end slot, the start is worth another look,
      // unless that would pull focus away.
      if (inSlot() && placedBefore && layout === layoutKey && (slot.id === START || busy())) {
        for (const form of ['wide', 'compact']) {
          setForm(form);
          if (fits(slot, placedBefore)) return;
        }
      }
      if (busy()) return;
      const paused = Date.now() < pausedUntil;
      const slots = { [START]: paused ? null : findSlot(START), [END]: paused ? null : findSlot(END) };
      tried = [document.getElementById(START), document.getElementById(END)];
      // Each spot measured without Taro, then with it; the first that leaves Meet's bar as it was wins.
      for (const [id, form] of PLANS) {
        const s = slots[id];
        if (!s) continue;
        host.remove();
        const before = measure(s);
        setForm(form);
        sizeFor(s);
        s.append(host);
        if (fits(s, before)) {
          slot = s;
          placedBefore = before;
          layoutKey = layout;
          missingSince = 0;
          liftNotices();
          return;
        }
      }
      host.remove();
      slot = placedBefore = null;
      // Meet draws its bar after the page loads and sometimes redraws it in two
      // steps, so give it a moment before settling for the floating spot.
      if (!slots[START] && !slots[END] && !paused) {
        if (!missingSince) missingSince = Date.now();
        if (Date.now() - missingSince < 2500 && !item.classList.contains('floating')) {
          layoutKey = '';
          return;
        }
      }
      layoutKey = layout;
      for (const p of FIT) item.style.removeProperty(p);
      setForm('floating');
      document.documentElement.append(host);
      liftNotices();
    } catch {
      // Meet changed under us; try again on the next tick rather than break the page.
      layoutKey = '';
    }
  }

  // Meet redraws its bar when panels open, the window resizes, or it moves
  // from the lobby into the call; when that drops the button, it goes back.
  function watchBar() {
    if (observer || !document.body) return;
    observer = new MutationObserver(() => {
      // Meet's page changes constantly; while the button sits in its slot this is all the work there is.
      if (!host || checkTimer || inSlot()) return;
      const dropped = !!slot;
      // Floating with nothing new to try: a new bar brings new slots.
      if (!dropped && document.getElementById(START) === tried[0] && document.getElementById(END) === tried[1] && host.isConnected) return;
      if (dropped) noteReinsert();
      // Dropped with a redraw: straight back, before anyone sees it gone. Otherwise look a few times a second at most.
      checkTimer = setTimeout(
        () => {
          checkTimer = null;
          place();
        },
        dropped ? 0 : Math.max(0, 250 - (Date.now() - lastSearch))
      );
    });
    observer.observe(document.body, { childList: true, subtree: true });
  }

  // If Meet keeps throwing the button out, stop fighting it and float for a while.
  function noteReinsert() {
    const now = Date.now();
    reinserts = reinserts.filter((t) => now - t < 10000);
    reinserts.push(now);
    if (reinserts.length > 20) {
      pausedUntil = now + 60000;
      reinserts = [];
    }
  }

  function stopWatching() {
    observer?.disconnect();
    observer = null;
    clearTimeout(checkTimer);
    checkTimer = null;
  }

  function onScroll() {
    hideTip();
  }

  function onResize() {
    hideTip();
    closeMenu(false);
    // Meet lays its bar out again as the window changes; so does Taro, once it settles.
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(place, 150);
  }

  // Google Sans arriving after the button first fits changes how wide its words
  // are, and Meet's; fit again once the fonts have loaded.
  function onFonts() {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => {
      // Already showing its words at the left end, a check where it stands will do; anywhere
      // else it is measured afresh, since the fonts may have made room for something better.
      if (!(inSlot() && slot.id === START && item.classList.contains('wide'))) layoutKey = '';
      place();
    }, 100);
  }

  // ---------------------------------------------------------------- actions

  async function onButtonClick(e) {
    // Only a real click or key press by the person counts; the page can't trigger an invite.
    if (!e.isTrusted || !lib || !view) return;
    hideTip();
    if (view.action === 'connect') {
      snapshot = (await send('taro.connect')) ?? snapshot;
      render();
    } else if (view.action === 'invite') {
      await invite(false);
    } else if (view.action === 'retry') {
      await invite(true);
    } else if (view.action === 'menu') {
      // Enter and Space click with no pointer (detail 0); they open onto the first item.
      if (menuOpen()) closeMenu(false);
      else openMenu(e.detail === 0 ? 'first' : 'menu');
    }
  }

  function onButtonKey(e) {
    if (!e.isTrusted) return;
    if (e.key === 'Escape') {
      // Escape dismisses what Taro shows and goes no further, like Meet's.
      if (tipShown() || menuOpen()) e.stopPropagation();
      hideTip();
      closeMenu(true);
    } else if ((e.key === 'ArrowDown' || e.key === 'ArrowUp') && view?.action === 'menu') {
      e.preventDefault();
      e.stopPropagation();
      openMenu(e.key === 'ArrowUp' ? 'last' : 'first');
    }
  }

  async function invite(retry) {
    if (sending) return;
    sending = true;
    const before = { ...(snapshot ?? {}), sending: true, error: null };
    snapshot = { ...(snapshot ?? {}), error: null };
    render();
    if (retry) await send('taro.dismiss');
    const after = await send('taro.invite');
    sending = false;
    if (dead) return;
    snapshot = after ?? snapshot;
    notice(lib.noticeFor('invite', before, after));
    render();
  }

  async function onMenuItem(e, id) {
    if (!e.isTrusted) return;
    closeMenu(true);
    if (id === 'leave') {
      const before = snapshot;
      const after = await send('taro.leave');
      if (dead) return;
      snapshot = after ?? snapshot;
      notice(lib.noticeFor('leave', before, after));
      render();
    } else if (id === 'open') await send('taro.open');
  }

  async function refresh(fromServer) {
    const before = snapshot;
    const next = await send('taro.state', { refresh: fromServer });
    if (dead) return;
    // A failed status check isn't something the person did, so it never shows as
    // a failed invite; the last known meeting stands and only an invite's own error
    // does, until Taro turns up in the call some other way.
    const live = ['pending', 'joining', 'active'].includes(next?.meeting?.status);
    snapshot = next ? { ...next, error: live ? null : (before?.error ?? null) } : snapshot;
    if (snapshot && snapshot.showButton === false) {
      unmount();
      return;
    }
    if (!host) mount();
    if (!sending) {
      // Each moment is announced once per meeting, even if the server goes back and forth.
      const text = lib.noticeFor('poll', before, snapshot);
      const key = `${snapshot?.meeting?.id}\n${text}`;
      if (text && !announced.has(key)) {
        announced.add(key);
        notice(text);
      }
    }
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
    // Dropped by a redraw, or the bar changed shape (Meet added or hid something, or a slot appeared): place it again.
    if (host && ((slot && !inSlot()) || (!busy() && currentLayout() !== layoutKey))) place();
    if (next === code) return;
    code = next;
    snapshot = null;
    if (code) refresh(true);
    else unmount();
  }

  (async () => {
    try {
      const [meet, control] = await Promise.all([
        import(chrome.runtime.getURL('src/lib/meet.js')),
        import(chrome.runtime.getURL('src/lib/control.js')),
      ]);
      lib = { meetingCodeFromPath: meet.meetingCodeFromPath, controlView: control.controlView, noticeFor: control.noticeFor, noticeKind: control.noticeKind };
    } catch {
      return;
    }
    tick();
    // Meet changes rooms without reloading the page.
    setInterval(tick, 1000);
    document.addEventListener('visibilitychange', () => {
      if (!document.hidden && code) refresh(true);
    });
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area === 'local' && ('auth' in changes || 'showButton' in changes || 'expired' in changes) && code) refresh(false);
    });
  })();
})();
