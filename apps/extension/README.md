# Taro for Google Meet

A Chrome and Edge extension that puts a Taro button in the bottom bar of every Google Meet call, next to Meet's own Chat and Meeting tools buttons. One click sends the workspace's Taro bot into the meeting. A Google Workspace admin can install and pin it for the whole company from the Admin console, so nobody has to paste a link again.

It needs no build step: the folder loads as is.

## How it works

* **The button** sits in the slot Meet leaves for extension buttons (`#browser-extension-end-buttons`), right before Meet's own group of Chat, Meeting tools, and Host controls, and looks like one of them. It takes Meet's sizes, colors, hover and press layers, and focus ring from the page, so it follows whichever bar layout Meet shows, and in Meet's current layout its part of the rounded group runs straight on into Meet's. Meet leaves that slot alone when it redraws; when Meet rebuilds the whole bar, the button goes straight back in. If a future Meet drops the slot, the button goes right before Meet's group, and if there is no bar at all, it floats at the bottom left. It lives in a closed shadow root and reads one thing from the page besides where Meet's controls are: the meeting code in the address (`meet.google.com/abc-defg-hij`). It never reads captions, chat, or names, and it only reacts to real clicks and key presses, so a script on the page can't trigger an invite.
* **The background worker** is the only part that talks to Taro. It holds the connection token in extension storage, which Meet's page can't reach, and it rebuilds the meeting link from the code itself.
* **Connecting** happens once per browser. The button (or the toolbar popup) opens the Taro dashboard at `/extension/connect`. After the person signs in and clicks **Connect this browser**, the dashboard hands the extension a token that can only send Taro to meetings, check on them, and make Taro leave. It can't read transcripts or change settings, and it shows up in the dashboard's list of connected browsers, where it can be revoked.
* **Permissions:** `storage` and `activeTab`, plus the Meet page for the button. No Google sign-in and no Google API scopes.

The button speaks Meet's own visual language. Its tooltip (and its name for screen readers) says what a click does or what is happening:

| State | Tooltip | Look | A click |
| --- | --- | --- | --- |
| Not connected | Connect Taro to this browser | Resting, outlined mark | Opens the connect page |
| Signed out | Reconnect Taro | Resting, outlined mark | Opens the connect page |
| Ready | Invite Taro | Resting, outlined mark | Sends Taro |
| Sending, or the bot starting up | Taro is joining | Outlined mark in Meet's blue | Nothing while sending, then the menu |
| Asking to be let in | Waiting for someone to admit Taro | Outlined mark in Meet's blue | Opens the menu |
| In the call | Taro is listening | Filled mark in Meet's blue, like an open panel's button | Opens the menu |
| Turned away, or the invite failed | Taro couldn't join. Try again | Resting, outlined mark | Sends Taro again |

The server says whether a joining bot is still starting up or already asking to be let in (`joinStage`); a server that doesn't say counts as asking. The menu offers **Remove Taro** and **Open in Taro**, with Taro's last answer above them once it has one. It opens and moves like Meet's own: arrow keys step through it, Escape closes it, and Tab moves on. Notices appear at the bottom left, where Meet's own appear, at the moments that matter: Taro on its way, Taro asking to join (the moment someone needs to click Admit), Taro listening, Taro couldn't join and why, and a reminder to connect this browser first. Plain updates close on their own after five seconds; the ones that ask for something or explain a failure stay ten and offer Dismiss. Menus and notices follow Meet's Appearance theme, light or dark.

## Try it locally

1. Open `chrome://extensions`, turn on **Developer mode**, click **Load unpacked**, and choose this folder (`apps/extension`).
2. The `key` in `manifest.json` pins the development ID to `lkdndnkaapmpibnjmaiadheckoflifde`. The Taro API and dashboard must trust it:
   * API `.env`: `EXTENSION_IDS=lkdndnkaapmpibnjmaiadheckoflifde`
   * Dashboard `apps/web/.env.local`: `NEXT_PUBLIC_TARO_EXTENSION_IDS=lkdndnkaapmpibnjmaiadheckoflifde`
3. `src/config.js` points the extension at `https://trytaro.vercel.app`. To use a local dashboard instead, change it in the popup's **Settings** (for example `http://localhost:3100`); any `localhost` port can connect.
4. Join any Google Meet call. The button appears in the bottom bar, just before Meet's Chat button.

Tests for the pure logic: `node --test test/*.test.mjs`.

## Publish

1. In `src/config.js`, set `DEFAULT_APP_URL` to your production dashboard, for example `https://taro.example.com`.
2. In `manifest.json`, add the same origin to `externally_connectable.matches` (for example `"https://taro.example.com/*"`), and delete the `key` line. The Chrome Web Store assigns its own ID.
3. Zip the folder's contents and upload them in the [Chrome Web Store developer dashboard](https://chrome.google.com/webstore/devconsole). Registration is a one-time fee. Name it in the "Taro for Google Meet" pattern, describe the single purpose (inviting Taro into the current Meet call), justify `storage`, `activeTab`, and the Meet page access, and link a privacy policy. Say plainly that the extension reads only the meeting code from the page.
4. Once published, add the store ID to the API's `EXTENSION_IDS` and the dashboard's `NEXT_PUBLIC_TARO_EXTENSION_IDS`, and set `NEXT_PUBLIC_TARO_EXTENSION_URL` to the store listing so the dashboard can link to it.
5. For Microsoft Edge, submit the same zip in [Partner Center](https://partner.microsoft.com/dashboard/microsoftedge/overview) and add that ID too.

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
