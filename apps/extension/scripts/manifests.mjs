// @ts-check
// One source manifest (manifest.json, the Chromium one) and the changes Firefox needs.

export const FIREFOX_ID = 'taro@trytaro.vercel.app';
// Firefox 128 ESR: Manifest V3 module background scripts, storage.session, and
// host permissions granted at install.
export const FIREFOX_MIN_VERSION = '128.0';

/** The dashboard pages the Firefox bridge runs on: the same origins Chrome lets message the extension. */
function connectPages(manifest) {
  return (manifest.externally_connectable?.matches ?? []).map((m) => m.replace(/\/\*$/, '/extension/connect*'));
}

/** Chrome, Edge, Brave, Opera, Arc, Vivaldi: the source manifest as is. Its `key` keeps the unpacked ID stable. */
export function chromiumManifest(manifest) {
  return structuredClone(manifest);
}

/** Firefox: background scripts instead of a service worker, a gecko ID, and no Chrome only keys. */
export function firefoxManifest(manifest) {
  const m = structuredClone(manifest);
  const bridge = { matches: connectPages(manifest), js: ['src/firefox-bridge.js'], run_at: 'document_start' };
  delete m.key;
  delete m.minimum_chrome_version;
  delete m.externally_connectable;
  delete m.storage;
  m.background = { scripts: [manifest.background.service_worker], type: manifest.background.type };
  m.content_scripts = [...m.content_scripts, bridge];
  m.browser_specific_settings = {
    gecko: {
      id: FIREFOX_ID,
      strict_min_version: FIREFOX_MIN_VERSION,
      // The extension only sends the meeting code to the Taro server the person connects; nothing goes to its makers.
      data_collection_permissions: { required: ['none'] },
    },
  };
  return m;
}
