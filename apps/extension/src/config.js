// @ts-check
// Where the Taro dashboard lives. Set this to your production dashboard before
// publishing; people can still point the extension at another Taro server in
// its settings, and admins can set it for everyone with the "appUrl" policy.
export const DEFAULT_APP_URL = 'https://trytaro.vercel.app';

// Firefox names the extension by its gecko id, which the dashboard's connect page
// doesn't take, and it has no externally_connectable. There the connect page talks
// to a small bridge script instead (src/firefox-bridge.js), and the extension
// introduces itself with the Chromium build's ID, which the dashboard already trusts
// (NEXT_PUBLIC_TARO_EXTENSION_IDS). Change it along with that list when publishing.
export const CONNECT_ID_FALLBACK = 'lkdndnkaapmpibnjmaiadheckoflifde';
