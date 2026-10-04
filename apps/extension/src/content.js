// Taro's button in Google Meet. It goes in the slot Meet leaves for extension
// buttons at the end of its bottom bar, right before Meet's own Chat and
// Meeting tools group, and takes that group's look: Meet's sizes, colors,
// states, and focus ring, read from the page wherever Meet exposes them, so it
// follows Meet's theme and layout. Everything lives in closed shadow roots the
// page can't reach into, and only real clicks and key presses act. It never
// reads captions, chat, or names: from the page it takes only the meeting code
// in the address and where Meet's controls are.
(() => {
  if (window.__taroInvite) return;
  window.__taroInvite = true;

  // The Taro mark (apps/web/src/components/brand.tsx) on Meet's 24px icon grid,
  // in the two forms Meet's own toggles use: outlined at rest, filled when on.
  // Strokes match Meet's 2px icons and the bars sit on whole pixels.
  const SPROUT = '<path d="M12 6.08V2.5M12 4.14L9.64 2.5M12 4.14L14.36 2.5" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>';
  const MARKS =
    '<svg class="mark outline" viewBox="0 0 24 24" width="24" height="24" aria-hidden="true" focusable="false">' +
    SPROUT +
    '<path d="M12 6.79C14.44 6.97 17.62 10.43 17.62 14.7C17.62 18.61 15.01 21.5 12 21.5C8.99 21.5 6.38 18.61 6.38 14.7C6.38 10.43 9.56 6.97 12 6.79Z" fill="none" stroke="currentColor" stroke-width="2"/>' +
    '<path d="M9.5 14v1M12 12.75v3.5M14.5 14v1" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>' +
    '<svg class="mark filled" viewBox="0 0 24 24" width="24" height="24" aria-hidden="true" focusable="false">' +
    SPROUT +
    '<path fill="currentColor" fill-rule="evenodd" d="M12 5.79C14.88 5.99 18.62 9.92 18.62 14.77C18.62 19.22 15.54 22.5 12 22.5C8.46 22.5 5.38 19.22 5.38 14.77C5.38 9.92 9.12 5.99 12 5.79Z' +
    'M8 13.5a1 1 0 0 1 2 0v2a1 1 0 0 1 -2 0ZM11 12a1 1 0 0 1 2 0v5a1 1 0 0 1 -2 0ZM14 13.5a1 1 0 0 1 2 0v2a1 1 0 0 1 -2 0Z"/></svg>';

  // Material Symbols (Apache 2.0), the set Meet's own icons come from.
  const symbol = (d) =>
    `<svg viewBox="0 -960 960 960" width="24" height="24" aria-hidden="true" focusable="false"><path fill="currentColor" d="${d}"/></svg>`;
  const SYMBOLS = {
    leave: symbol('M200-120q-33 0-56.5-23.5T120-200v-560q0-33 23.5-56.5T200-840h280v80H200v560h280v80H200Zm440-160-55-58 102-102H360v-80h327L585-622l55-58 200 200-200 200Z'),
    open: symbol('M200-120q-33 0-56.5-23.5T120-200v-560q0-33 23.5-56.5T200-840h280v80H200v560h560v-280h80v280q0 33-23.5 56.5T760-120H200Zm188-212-56-56 372-372H560v-80h280v280h-80v-144L388-332Z'),
  };

  // Meet's GM3 color tokens are inherited custom properties, which `all: initial`
  // leaves alone, so inside the bar these resolve to Meet's live theme. The
  // fallbacks are Meet's dark values, for the floating spot outside the bar.
  // Meet loads Google Sans and Roboto; the bundled face stands in for both.
  const TOKENS = `
    --sans: 'Google Sans', 'Taro Record', Roboto, Arial, sans-serif;
    --on-surface-variant: var(--gm3-sys-color-on-surface-variant, #c4c7c5);
    --on-background: var(--gm3-sys-color-on-background, #e3e3e3);
    --surface-container: var(--gm3-sys-color-surface-container, #1e1f20);
    --primary-fixed-dim: var(--gm3-sys-color-primary-fixed-dim, #a8c7fa);
    --secondary: var(--gm3-sys-color-secondary, #7fcfff);
  `;

  const STYLE = `
    :host { all: initial !important; display: inline-flex !important; vertical-align: top !important; flex: none !important; ${TOKENS} }
    /* The slot of Meet's group that Taro fills. When it sits against Meet's pill
       it draws the pill's start and reaches under Meet's rounded end, so the two
       read as one group; every number here comes from Meet's group at runtime. */
    .item { display: flex; align-items: center; box-sizing: border-box; height: var(--pill-h, auto); margin: 0 0 var(--pill-mb, 0px);
      margin-inline-end: var(--merge, 0px); padding-inline-start: var(--pill-pad, 0px); background: var(--pill-bg, transparent);
      border-start-start-radius: var(--pill-r, 0px); border-end-start-radius: var(--pill-r, 0px); }
    /* Meet paints its pill after this slot, so this strip only shows where Meet's rounded end leaves a gap. */
    .item::after { content: ''; flex: none; align-self: stretch; width: var(--pill-reach, 0px); margin-inline-end: calc(-1 * var(--pill-reach, 0px));
      background: var(--pill-bg, transparent); pointer-events: none; }
    .item.floating { position: fixed; inset-inline-start: 16px; bottom: 88px; z-index: 2147482000; height: auto; margin: 0; padding: 0 4px;
      border-radius: 28px; background: var(--surface-container); }
    .item.floating::after { display: none; }
    .control { position: relative; display: grid; place-items: center; box-sizing: border-box; flex: none;
      width: var(--btn, 48px); height: var(--btn, 48px); margin: var(--btn-my, 4px) 0; padding: 0; border: 0;
      border-radius: calc(var(--btn, 48px) / 2); background: transparent; color: var(--icon, var(--on-surface-variant));
      cursor: pointer; outline: none; -webkit-tap-highlight-color: transparent; user-select: none; }
    .control::before { content: ''; position: absolute; inset: 0; border-radius: inherit; pointer-events: none; opacity: 0;
      background: var(--hover-color, var(--on-background)); transition: opacity 75ms linear; }
    .control:hover::before { opacity: var(--hover-opacity, 0.12); }
    .control:active::before { background: var(--pressed-color, var(--on-background)); opacity: var(--pressed-opacity, 0.16); transition-duration: 105ms; }
    .control[aria-disabled='true'] { cursor: default; }
    .control[aria-disabled='true']:active::before { opacity: var(--hover-opacity, 0.12); }
    /* Meet's focus ring: 3px of its secondary color, 2px out, flaring once as it appears. */
    .control::after { content: ''; position: absolute; inset: -2px; display: none; border-radius: calc(var(--btn, 48px) / 2 + 2px);
      pointer-events: none; box-shadow: 0 0 0 3px var(--secondary); }
    .control:focus-visible::after { display: block; animation: ring-grow 150ms cubic-bezier(0.2, 0, 0, 1), ring-settle 450ms cubic-bezier(0.2, 0, 0, 1) 150ms; }
    @keyframes ring-grow { from { box-shadow: 0 0 0 0 var(--secondary); } to { box-shadow: 0 0 0 8px var(--secondary); } }
    @keyframes ring-settle { from { box-shadow: 0 0 0 8px var(--secondary); } }
    @media not (prefers-reduced-motion) {
      .control { transition: border-radius 200ms steps(6, jump-none); }
      .control:active { border-radius: 8px; }
      .control:active::after { border-radius: 10px; }
    }
    @media (prefers-reduced-motion) { .control:focus-visible::after { animation: none; } }
    .mark { display: block; width: var(--icon-size, 24px); height: var(--icon-size, 24px); pointer-events: none; }
    .filled { display: none; }
    .control.progress, .control.on { color: var(--primary-fixed-dim); }
    .control.on .outline { display: none; }
    .control.on .filled { display: block; }

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
      .control:focus-visible::after { box-shadow: none; outline: 3px solid CanvasText; }
      .control.on { outline: 1px solid CanvasText; }
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
  /** @type {{ label: string, action: string, look: string, answer?: string, menu: Array<{ id: string, label: string }> } | null} */
  let view = null;

  let host = null;
  let item = null;
  let button = null;
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
    item.className = 'item';
    button = document.createElement('button');
    button.type = 'button';
    button.className = 'control rest';
    button.innerHTML = MARKS;
    tip = document.createElement('div');
    tip.className = 'tip';
    tip.setAttribute('popover', 'manual');
    // The tooltip repeats the button's name, so screen readers hear it once.
    tip.setAttribute('aria-hidden', 'true');
    menu = document.createElement('div');
    menu.className = 'menu';
    menu.setAttribute('popover', 'manual');
    menu.setAttribute('role', 'menu');
    menu.setAttribute('aria-label', 'Taro');
    menu.tabIndex = -1;
    item.append(button, tip, menu);
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

    place();
    watchBar();
  }

  function unmount() {
    stopPolling();
    stopWatching();
    clearTimeout(tipTimer);
    clearTimeout(menuTimer);
    document.removeEventListener('pointerdown', onOutsidePointer, true);
    window.removeEventListener('blur', onWindowBlur);
    window.removeEventListener('scroll', onScroll, true);
    window.removeEventListener('resize', onResize);
    host?.remove();
    host = item = button = tip = menu = null;
    slot = group = null;
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
    lastKey = key;
    view = next;
    button.setAttribute('aria-label', next.label);
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
    tip.textContent = next.label;
    if (tipShown()) positionTip();
    buildMenu(next);
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
    if (!tip || !host?.isConnected || menuOpen() || !view) return;
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
    const words = document.createElement('div');
    words.className = 'text';
    words.textContent = text;
    snack.append(words);
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

  // Meet renders an empty #browser-extension-end-buttons just before its own
  // Chat and Meeting tools group, says in the page that extensions may put
  // buttons there, and leaves that slot's contents alone when it redraws. If a
  // future Meet drops the slot, the button goes right before Meet's group,
  // found by what makes those buttons work in any language: real buttons in
  // the bar that open Meet's side panel.
  const SLOT = 'browser-extension-end-buttons';
  const PANEL_BUTTONS = 'button[aria-controls][data-panel-id], [role="button"][aria-controls][data-panel-id]';
  const FIT = ['--pill-bg', '--pill-h', '--pill-r', '--pill-pad', '--pill-mb', '--pill-reach', '--merge', '--btn', '--btn-my', '--icon',
    '--icon-size', '--hover-color', '--hover-opacity', '--pressed-color', '--pressed-opacity'];

  let slot = null;
  let group = null;
  let observer = null;
  let checkTimer = null;
  let lastSearch = 0;
  let missingSince = 0;
  let reinserts = [];
  let pausedUntil = 0;
  let fitKey = '';

  function shown(el) {
    if (!el) return false;
    if (typeof el.checkVisibility === 'function' && !el.checkVisibility()) return false;
    const r = el.getBoundingClientRect();
    return r.width > 0 && r.height > 0;
  }

  /** Meet's own group of panel buttons in the bottom bar, if it is on screen. */
  function meetGroup() {
    for (const b of document.querySelectorAll(PANEL_BUTTONS)) {
      const r = b.getBoundingClientRect();
      // Meeting details can live at the top of the window; only the bar's buttons count.
      if (!shown(b) || r.bottom < innerHeight - 140) continue;
      const nav = b.closest('nav');
      if (nav) return nav;
      let wrap = b;
      while (wrap.parentElement && wrap.parentElement.querySelectorAll(PANEL_BUTTONS).length === 1) wrap = wrap.parentElement;
      return wrap.parentElement ? wrap : null;
    }
    return null;
  }

  function findSpot() {
    for (const s of document.querySelectorAll(`[id="${SLOT}"]`)) {
      if (!shown(s.parentElement)) continue;
      let next = s.nextElementSibling;
      while (next && !shown(next)) next = next.nextElementSibling;
      return { parent: s, before: null, group: next && (next.matches('nav') || next.querySelector(PANEL_BUTTONS)) ? next : null };
    }
    const g = meetGroup();
    return g?.parentElement ? { parent: g.parentElement, before: g, group: g } : null;
  }

  function inBar() {
    return !!host?.isConnected && !!slot?.isConnected && host.parentNode === slot;
  }

  function place() {
    if (!host || dead) return;
    lastSearch = Date.now();
    try {
      const spot = Date.now() < pausedUntil ? null : findSpot();
      if (spot) {
        // Never reorder what's already in Meet's slot; other extensions share it.
        if (host.parentNode !== spot.parent || (spot.before && host.nextSibling !== spot.before)) {
          const hadFocus = host.matches(':focus-within');
          spot.parent.insertBefore(host, spot.before);
          if (hadFocus) button.focus();
        }
        slot = spot.parent;
        group = spot.group;
        missingSince = 0;
        item.classList.remove('floating');
        fit();
        liftNotices();
        return;
      }
      slot = group = null;
      // Meet draws its bar after the page loads and sometimes redraws it in two
      // steps, so give it a moment before settling for the floating spot.
      if (!missingSince) missingSince = Date.now();
      if (Date.now() - missingSince < 2500 && !item.classList.contains('floating')) {
        host.remove();
        return;
      }
      if (host.parentNode !== document.documentElement) document.documentElement.append(host);
      for (const p of FIT) item.style.removeProperty(p);
      fitKey = '';
      item.classList.add('floating');
      liftNotices();
    } catch {
      // Meet changed under us; try again on the next tick rather than break the page.
    }
  }

  /**
   * Takes on the look of Meet's group next door: its buttons' size, margins,
   * icon color, and hover and press layers, and when the button sits right
   * against Meet's pill, the pill itself.
   */
  function fit() {
    if (!item || !host) return;
    const values = {};
    const ref = group && [...group.querySelectorAll('button, [role="button"]')].find(
      (b) => shown(b) && b.getAttribute('aria-expanded') !== 'true' && b.getBoundingClientRect().height >= 32
    );
    let spacing = 0;
    if (ref) {
      const r = ref.getBoundingClientRect();
      const cs = getComputedStyle(ref);
      if (r.height <= 64) values['--btn'] = `${Math.round(r.height)}px`;
      values['--btn-my'] = cs.marginTop;
      values['--icon'] = cs.color;
      const glyph = [...ref.querySelectorAll('i, svg, img')].find(shown)?.getBoundingClientRect();
      if (glyph && glyph.height >= 16 && glyph.height <= 32) values['--icon-size'] = `${Math.round(glyph.height)}px`;
      // Meet's buttons sit edge to edge today; if a later layout spaces them out, so does Taro.
      const buttons = [...group.querySelectorAll('button, [role="button"]')].filter(shown);
      const second = buttons[buttons.indexOf(ref) + 1]?.getBoundingClientRect();
      const between = second ? Math.round(Math.abs(second.left - r.left) - r.width) : 0;
      if (between > 0 && between <= 24) spacing = between;
      for (const [ours, meets] of [
        ['--hover-color', '--gm3-icon-button-filled-hover-state-layer-color'],
        ['--hover-opacity', '--gm3-icon-button-filled-hover-state-layer-opacity'],
        ['--pressed-color', '--gm3-icon-button-filled-pressed-state-layer-color'],
        ['--pressed-opacity', '--gm3-icon-button-filled-pressed-state-layer-opacity'],
      ]) {
        const v = cs.getPropertyValue(meets).trim();
        if (v) values[ours] = v;
      }
    }
    const nextToGroup = group && (group.parentNode === host.parentNode ? host.nextElementSibling === group : host.parentNode.lastElementChild === host);
    if (nextToGroup) {
      const n = getComputedStyle(group);
      const gap = parseFloat(n.marginInlineStart) || 0;
      const pad = parseFloat(n.paddingInlineStart) || 0;
      const filled = !/^(transparent|rgba\(0, 0, 0, 0\))$/.test(n.backgroundColor);
      values['--merge'] = `${spacing - gap - (filled ? pad : 0)}px`;
      if (filled) {
        const height = group.getBoundingClientRect().height;
        const radius = Math.min(parseFloat(n.borderStartStartRadius) || 0, height / 2);
        values['--pill-bg'] = n.backgroundColor;
        values['--pill-h'] = `${height}px`;
        values['--pill-r'] = `${radius}px`;
        values['--pill-pad'] = `${pad}px`;
        values['--pill-mb'] = n.marginBottom;
        // Reaches under the start of Meet's pill, behind its rounded end, so the seam disappears.
        values['--pill-reach'] = `${radius}px`;
      }
    }
    const key = JSON.stringify(values);
    if (key === fitKey) return;
    fitKey = key;
    for (const p of FIT) item.style.removeProperty(p);
    for (const [p, v] of Object.entries(values)) item.style.setProperty(p, v);
  }

  // Meet redraws its bar when panels open, the window resizes, or it moves
  // from the lobby into the call; when that drops the button, it goes back.
  function watchBar() {
    if (observer || !document.body) return;
    observer = new MutationObserver(() => {
      // Meet's page changes constantly; while the button sits in the bar this is all the work there is.
      if (!host || checkTimer || inBar()) return;
      // Dropped with a redraw: straight back, before anyone sees it gone. Otherwise look a few times a second at most.
      const dropped = !!slot;
      if (dropped) noteReinsert();
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
    // Meet restyles its group in narrow windows; follow it.
    if (inBar()) fit();
    else place();
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
    if (host) {
      // Meet hides parts of its bar in small windows; a slot that is still on the page but hidden doesn't count.
      if (!inBar() || !shown(slot.parentElement)) place();
      else fit();
    }
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
