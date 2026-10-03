// @ts-check
// What the Invite Taro button says and offers, from the extension's state and
// the meeting's status. States are words; nothing pulses or blinks.

/**
 * @typedef {'pending' | 'joining' | 'active' | 'ended' | 'error'} MeetingStatus
 * @typedef {{
 *   connected: boolean,
 *   expired?: boolean,
 *   sending?: boolean,
 *   meeting?: { id: string, status: MeetingStatus, errorMessage?: string, lastAnswer?: string, waitingSince?: number } | null,
 *   error?: string | null,
 * }} PillInput
 * @typedef {{
 *   label: string,
 *   action: 'connect' | 'invite' | 'menu' | 'none',
 *   tone: 'taro' | 'quiet' | 'alert',
 *   busy: boolean,
 *   detail?: string,
 *   menu: Array<{ id: 'leave' | 'open' | 'retry' | 'dismiss', label: string }>,
 * }} PillView
 */

const LIVE = new Set(['pending', 'joining', 'active']);

/** @param {PillInput} s @returns {PillView} */
export function pillView(s) {
  if (s.expired) {
    return { label: 'Reconnect Taro', action: 'connect', tone: 'alert', busy: false, detail: 'This browser was signed out of Taro.', menu: [] };
  }
  if (!s.connected) {
    return { label: 'Connect Taro', action: 'connect', tone: 'taro', busy: false, menu: [] };
  }
  if (s.sending) {
    return { label: 'Sending Taro', action: 'none', tone: 'taro', busy: true, menu: [] };
  }
  const m = s.meeting;
  if (m && LIVE.has(m.status)) {
    const open = { id: /** @type {const} */ ('open'), label: 'Open in Taro' };
    const leave = { id: /** @type {const} */ ('leave'), label: 'Remove Taro' };
    if (m.status === 'active') {
      return { label: 'Taro is listening', action: 'menu', tone: 'taro', busy: false, detail: m.lastAnswer, menu: [leave, open] };
    }
    return {
      label: 'Waiting to be admitted',
      action: 'menu',
      tone: 'taro',
      busy: false,
      detail: 'Someone in the host’s organization needs to let Taro in. Look for it in the list of people asking to join.',
      menu: [leave, open],
    };
  }
  if (m && m.status === 'error') {
    return {
      label: 'Taro couldn’t join',
      action: 'menu',
      tone: 'alert',
      busy: false,
      detail: m.errorMessage || 'Send Taro again, and admit it when it asks to join.',
      menu: [
        { id: 'retry', label: 'Send Taro again' },
        { id: 'dismiss', label: 'Dismiss' },
      ],
    };
  }
  if (s.error) {
    return {
      label: 'Taro couldn’t join',
      action: 'menu',
      tone: 'alert',
      busy: false,
      detail: s.error,
      menu: [
        { id: 'retry', label: 'Try again' },
        { id: 'dismiss', label: 'Dismiss' },
      ],
    };
  }
  return { label: 'Invite Taro', action: 'invite', tone: 'taro', busy: false, menu: [] };
}
