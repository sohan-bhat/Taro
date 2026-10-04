// @ts-check
// What Taro's button in Meet's bar says, how it looks, and what a click does,
// from the extension's state and the meeting's status. The label is the short
// word or two on the button and its accessible name; the tip is the longer
// explanation, shown as a tooltip where it adds something and used as the
// name when there is room only for the mark. Looks are a tonal ramp in Taro's
// purple: resting, a brighter one while Taro is on its way in, and a light,
// unmistakable one while Taro is in the call. Nothing pulses or blinks.

/**
 * @typedef {'pending' | 'joining' | 'active' | 'ended' | 'error'} MeetingStatus
 * @typedef {{ id: string, status: MeetingStatus, joinStage?: 'starting' | 'lobby', errorMessage?: string, lastAnswer?: string }} Meeting
 * @typedef {{
 *   connected: boolean,
 *   expired?: boolean,
 *   sending?: boolean,
 *   meeting?: Meeting | null,
 *   error?: string | null,
 * }} ControlInput
 * @typedef {'rest' | 'progress' | 'on'} Look
 * @typedef {{
 *   label: string,
 *   tip: string,
 *   action: 'connect' | 'invite' | 'retry' | 'menu' | 'none',
 *   look: Look,
 *   answer?: string,
 *   menu: Array<{ id: 'leave' | 'open', label: string }>,
 * }} ControlView
 */

const MENU = /** @type {ControlView['menu']} */ ([
  { id: 'leave', label: 'Remove Taro' },
  { id: 'open', label: 'Open in Taro' },
]);

// "pending" until the bot is dispatched, then "joining": with joinStage
// "starting" while the bot starts up (12 to 20 seconds), then "lobby" once it
// is asking to be let in. Older servers send no joinStage; that reads as the lobby.
/** @param {Meeting | null | undefined} m */
const starting = (m) => m?.status === 'pending' || (m?.status === 'joining' && m.joinStage === 'starting');
/** @param {Meeting | null | undefined} m */
const inLobby = (m) => m?.status === 'joining' && m.joinStage !== 'starting';

/** @param {ControlInput} s @returns {ControlView} */
export function controlView(s) {
  if (s.expired) return { label: 'Reconnect Taro', tip: 'Reconnect Taro', action: 'connect', look: 'rest', menu: [] };
  if (!s.connected) return { label: 'Connect Taro', tip: 'Connect Taro to this browser', action: 'connect', look: 'rest', menu: [] };
  if (s.sending) return { label: 'Taro is joining', tip: 'Taro is joining', action: 'none', look: 'progress', menu: [] };
  const m = s.meeting;
  if (starting(m)) return { label: 'Taro is joining', tip: 'Taro is joining', action: 'menu', look: 'progress', menu: MENU };
  if (inLobby(m)) return { label: 'Waiting to be admitted', tip: 'Waiting for someone to admit Taro', action: 'menu', look: 'progress', menu: MENU };
  if (m?.status === 'active') {
    const view = /** @type {ControlView} */ ({ label: 'Taro is listening', tip: 'Taro is listening', action: 'menu', look: 'on', menu: MENU });
    return m.lastAnswer ? { ...view, answer: m.lastAnswer } : view;
  }
  if (m?.status === 'error' || s.error) return { label: 'Try again', tip: 'Taro couldn’t join. Try again', action: 'retry', look: 'rest', menu: [] };
  return { label: 'Invite Taro', tip: 'Invite Taro', action: 'invite', look: 'rest', menu: [] };
}

/**
 * The snackbar a change deserves, or null. Only moments this page saw happen
 * count: the outcome of the person's own invite or removal, and Taro reaching
 * the lobby, being admitted, or being turned away while they waited. A page
 * that loads into a state stays quiet; the button already shows it.
 * @param {'invite' | 'leave' | 'poll'} act
 * @param {ControlInput | null} before
 * @param {ControlInput | null} after
 * @returns {string | null}
 */
export function noticeFor(act, before, after) {
  if (!after) return null;
  const signedOut = !after.connected || !!after.expired;
  const m = after.meeting;
  if (act === 'invite') {
    if (signedOut) return 'Connect this browser to Taro first.';
    if (m?.status === 'active') return LISTENING;
    if (m?.status === 'joining' && m.joinStage === 'lobby') return ASKING;
    if (starting(m) || inLobby(m)) return 'Taro is on its way. Admit it when it asks to join.';
    if (m?.status === 'error') return couldNot('join', m.errorMessage);
    if (after.error) return couldNot('join', after.error);
    return null;
  }
  if (act === 'leave') {
    if (signedOut) return 'Connect this browser to Taro first.';
    return after.error ? couldNot('leave', after.error) : null;
  }
  const was = before?.meeting;
  if (signedOut || !was || !(starting(was) || inLobby(was)) || was.id !== m?.id) return null;
  if (m?.status === 'active') return LISTENING;
  if (m?.status === 'error') return couldNot('join', m.errorMessage);
  // The moment someone in the call needs to click Admit.
  if (starting(was) && inLobby(m)) return ASKING;
  return null;
}

const LISTENING = 'Taro is listening. Say “Hey Taro” and what you need.';
const ASKING = 'Taro is asking to join. Admit it now.';

/**
 * How a notice behaves, like Meet's own two kinds. A plain update ("Gemini's
 * getting ready to take notes") stays five seconds with nothing to press. One
 * that asks the person to act or explains a failure ("Something went wrong.
 * Try again.") stays ten and offers Dismiss.
 * @param {string} text
 * @returns {{ ms: number, dismiss: boolean }}
 */
export function noticeKind(text) {
  const asks = text === ASKING || text.startsWith('Taro couldn’t') || text.startsWith('Connect this browser');
  return asks ? { ms: 10000, dismiss: true } : { ms: 5000, dismiss: false };
}

/** "Taro couldn’t join: {reason}", with the reason as one tidy sentence. */
function couldNot(verb, reason) {
  let text = String(reason ?? '').replace(/\s+/g, ' ').trim();
  // A dropped connection reads as the browser's own jargon; say what it means instead.
  if (/^(failed to fetch|networkerror\b|load failed)/i.test(text)) text = 'Taro can’t be reached right now.';
  if (!text) return `Taro couldn’t ${verb}. Try again.`;
  return `Taro couldn’t ${verb}: ${/[.!?]$/.test(text) ? text : `${text}.`}`;
}
