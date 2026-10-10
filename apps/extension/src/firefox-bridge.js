// Firefox only. Chrome and Edge let the Taro dashboard message the extension
// directly (externally_connectable); Firefox doesn't. So on the dashboard's
// connect page this script gives the page the one call it uses there,
// chrome.runtime.sendMessage(id, message, callback), and passes each message to
// the background worker, which checks the page's address and the nonce exactly
// as it does in Chrome. It runs before the page's own scripts and does nothing else.
(() => {
  /* global exportFunction, cloneInto */
  const page = /** @type {any} */ (window).wrappedJSObject;
  if (!page || typeof exportFunction !== 'function' || page.chrome?.runtime) return;

  const runtime = new page.Object();
  exportFunction(
    (_id, message, callback) => {
      let plain = null;
      try {
        plain = JSON.parse(JSON.stringify(message));
      } catch {}
      const answer = (reply) => {
        try {
          if (typeof callback === 'function') callback(cloneInto(reply ?? null, page));
        } catch {}
      };
      chrome.runtime.sendMessage({ type: 'taro.external', message: plain }).then(answer, () => answer(null));
    },
    runtime,
    { defineAs: 'sendMessage' }
  );
  const chromeObject = new page.Object();
  chromeObject.runtime = runtime;
  page.chrome = chromeObject;
})();
