# Taro for Google Meet

A browser extension for Chrome, Edge, Brave, Opera, Arc, Vivaldi, and Firefox that puts a purple Taro button at the left end of the bottom bar in every Google Meet call. One click sends the workspace's Taro bot into the meeting. A Google Workspace admin can install and pin it for the whole company from the Admin console, so nobody has to paste a link again.

It needs no build step: the folder loads as is in Chromium browsers. `pnpm --filter @taro/extension package` writes the two downloadable builds to `dist/`: `taro-extension-chromium.zip` (this folder as is) and `taro-extension-firefox.zip` (the same code with a Firefox manifest). Safari isn't supported yet.

## How it works

* **The button** is a Material 3 tonal button in Taro's purple, with the Taro mark and a word or two saying what it does, as tall as Meet's own items beside it. It sits in the slot Meet leaves for extension buttons at the left end of its bottom bar (`#browser-extension-start-buttons`), before the Ask Gemini field or the meeting time and code. Meet leaves that slot alone when it redraws, and when Meet rebuilds the whole bar the button goes straight back in.
* **It never crowds Meet.** Meet's fixed items (its buttons, the time and code) keep their size and stay in view, and Meet's center controls never move. A field Meet sizes to fit, like Ask Gemini, may give up some width, but never below the larger of 200px and what its icon, placeholder, and send button need, and not at all where Meet already shows it narrower than that. Where the button's words still don't fit at the left end, it shows just the mark there, with its words as a tooltip; in Meet's current layout that happens in windows around 1280px wide, and for Connect Taro up to about 1400px. With no room at the left at all, it goes to the slot before Meet's Chat group (`#browser-extension-end-buttons`), and with no room anywhere in the bar, or no bar, it floats at the bottom left.
* **It stays out of Meet's way.** It lives in a closed shadow root and reads one thing from the page besides where Meet's controls are: the meeting code in the address (`meet.google.com/abc-defg-hij`). It never reads captions, chat, or names, and it only reacts to real clicks and key presses, so a script on the page can't trigger an invite.
* **The background worker** is the only part that talks to Taro. It holds the connection token in extension storage, which Meet's page can't reach, and it rebuilds the meeting link from the code itself.
* **Connecting** happens once per browser. The button (or the toolbar popup) opens the Taro dashboard at `/extension/connect`. After the person signs in and clicks **Connect this browser**, the dashboard hands the extension a token that can only send Taro to meetings, check on them, and make Taro leave. It can't read transcripts or change settings, and it shows up in the dashboard's list of connected browsers, where it can be revoked.
* **Permissions:** `storage` and `activeTab`, plus the Meet page for the button. No Google sign-in and no Google API scopes.

The words on the button say what a click does, or what is happening; the Taro mark beside them already says whose button it is, so once Taro is on its way they drop the name. The tooltip and screen readers get the full sentence where it says more. Its color says how far along Taro is: Taro's purple at rest, a brighter purple while Taro is on its way in, and a light purple, unmistakably on, while Taro is in the call. Every pairing clears 4.5:1 contrast, hover and press included.

| State | Button | Tooltip | Look | A click |
| --- | --- | --- | --- | --- |
| Not connected | Connect Taro | Connect Taro to this browser | Taro purple (#4E3564), light words | Opens the connect page |
| Signed out | Reconnect | Reconnect Taro | Taro purple | Opens the connect page |
| Ready | Invite Taro | | Taro purple | Sends Taro |
| Sending, or the bot starting up | Joining | Taro is joining | Brighter purple (#6E5289) | Nothing while sending, then the menu |
| Asking to be let in | In the lobby | Waiting for someone to admit Taro | Brighter purple | Opens the menu |
| In the call | Listening | Taro is listening | Light purple (#DCC6F2), dark words | Opens the menu |
| Turned away, or the invite failed | Try again | Taro couldn't join. Try again | Taro purple | Sends Taro again |

The server says whether a joining bot is still starting up or already asking to be let in (`joinStage`); a server that doesn't say counts as asking. The menu offers **Remove Taro** and **Open in Taro**, with Taro's last answer above them once it has one. It opens and moves like Meet's own: arrow keys step through it, Escape closes it, and Tab moves on. Notices appear at the bottom left, where Meet's own appear, at the moments that matter: Taro on its way, Taro asking to join (the moment someone needs to click Admit), Taro listening, Taro couldn't join and why, and a reminder to connect this browser first. Plain updates close on their own after five seconds; the ones that ask for something or explain a failure stay ten and offer Dismiss. Menus and notices follow Meet's Appearance theme, light or dark.

## Try it locally

1. Open `chrome://extensions`, turn on **Developer mode**, click **Load unpacked**, and choose this folder (`apps/extension`).
2. The `key` in `manifest.json` pins the development ID to `lkdndnkaapmpibnjmaiadheckoflifde`. The Taro API and dashboard must trust it:
   * API `.env`: `EXTENSION_IDS=lkdndnkaapmpibnjmaiadheckoflifde`
   * Dashboard `apps/web/.env.local`: `NEXT_PUBLIC_TARO_EXTENSION_IDS=lkdndnkaapmpibnjmaiadheckoflifde`
3. `src/config.js` points the extension at `https://trytaro.vercel.app`. To use a local dashboard instead, change it in the popup's **Settings** (for example `http://localhost:3100`); any `localhost` port can connect.
4. Join any Google Meet call. The button appears at the left end of the bottom bar.

### Firefox

Run `pnpm --filter @taro/extension package`, open `about:debugging`, choose **This Firefox**, then **Load Temporary Add-on**, and pick `dist/firefox/manifest.json`. It stays until Firefox restarts. Firefox 128 or newer.

The Firefox build differs from the Chromium one in three ways, all made by `scripts/manifests.mjs`:

* Its background script runs as a Manifest V3 background script, since Firefox has no extension service workers, and its ID is `taro@trytaro.vercel.app`.
* Firefox doesn't let web pages message an extension (`externally_connectable`), so on the dashboard's connect page `src/firefox-bridge.js` gives the page the same `chrome.runtime.sendMessage` call it uses in Chrome. The background worker checks the page's address and the nonce the same way. The dashboard only opens links for extension IDs it trusts, so the Firefox build introduces itself with the Chromium build's ID (`CONNECT_ID_FALLBACK` in `src/config.js`).
* Each Firefox install calls the API from its own random `moz-extension://` origin. The API accepts those whenever `EXTENSION_IDS` is set.

Tests for the pure logic: `node --test test/*.test.mjs`.

## Publish

1. In `src/config.js`, set `DEFAULT_APP_URL` to your production dashboard, for example `https://taro.example.com`.
2. In `manifest.json`, add the same origin to `externally_connectable.matches` (for example `"https://taro.example.com/*"`), and delete the `key` line. The Chrome Web Store assigns its own ID.
3. Zip the folder's contents and upload them in the [Chrome Web Store developer dashboard](https://chrome.google.com/webstore/devconsole). Registration is a one-time fee. Name it in the "Taro for Google Meet" pattern, describe the single purpose (inviting Taro into the current Meet call), justify `storage`, `activeTab`, and the Meet page access, and link a privacy policy. Say plainly that the extension reads only the meeting code from the page.
4. Once published, add the store ID to the API's `EXTENSION_IDS` and the dashboard's `NEXT_PUBLIC_TARO_EXTENSION_IDS`, and set `NEXT_PUBLIC_TARO_EXTENSION_URL` to the store listing so the dashboard can link to it.
5. For Microsoft Edge, submit the same zip in [Partner Center](https://partner.microsoft.com/dashboard/microsoftedge/overview) and add that ID too.
6. For Firefox, set `CONNECT_ID_FALLBACK` in `src/config.js` to an ID the dashboard trusts, run `pnpm --filter @taro/extension package`, and submit `dist/taro-extension-firefox.zip` at [addons.mozilla.org](https://addons.mozilla.org/developers/). Signing is free, and a signed build stays installed after a restart. If your dashboard isn't `trytaro.vercel.app`, add it to `externally_connectable.matches` first: the Firefox build runs its bridge on the same addresses.

## Roll it out to a whole company

A Google Workspace admin, once:

1. Admin console, **Devices**, **Chrome**, **Apps & extensions**, **Users & browsers**.
2. Choose the organizational unit or group.
3. Click the add button, then **Add from Chrome Web Store** and search for Taro (or **Add Chrome app or extension by ID**).
4. Set the installation policy to **Force install + pin to browser toolbar**, and save.

Optionally, set the extension's policy so people never have to type an address:

```json
{
  "appUrl": { "Value": "https://taro.example.com" },
  "showButton": { "Value": true }
}
```

For Microsoft Edge, use Intune or Group Policy `ExtensionInstallForcelist` with the Edge Add-ons ID.

## What to expect in meetings

Taro joins as a guest, so someone from the host's organization admits it the first time it asks. Meetings limited to the host's organization can't admit outside guests at all. The button's tooltip says "Waiting for someone to admit Taro" while Taro is in the lobby.
