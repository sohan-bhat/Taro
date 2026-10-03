// What a MeetingBaas failure means for the person reading the dashboard, and whether
// "Send again" can help. Codes come from bot.failed (Meeting.errorCode).

export interface BotError {
  sentence: string;
  canResend: boolean;
}

const say = (sentence: string, canResend = true): BotError => ({ sentence, canResend });

const STOPPED = say('The meeting bot stopped unexpectedly. Send Taro again.');
const SIGN_IN_ONLY = say('This meeting only lets signed-in accounts join. Change its access settings so guests can ask to join.');
const NO_RECORDING = say("The Zoom host didn't let Taro listen. Ask the host to allow recording, then send Taro again.");

const BY_CODE: Record<string, BotError> = {
  BOT_NOT_ACCEPTED: say('Nobody let Taro in. Send it again and admit Taro when it asks to join.'),
  TIMEOUT_WAITING_TO_START: say('Nobody admitted Taro within 10 minutes. Send it again and admit Taro from the lobby.'),
  WAITING_FOR_HOST_TIMEOUT: say('The host never started the Zoom meeting. Send Taro again once the host joins.'),
  CANNOT_JOIN_MEETING: say("Taro couldn't reach this meeting. Check that the link works, then send it again."),
  INVALID_MEETING_URL: say("That meeting link doesn't work. Copy it again from the invite.", false),
  LOGIN_REQUIRED: SIGN_IN_ONLY,
  MEET_LOGIN_REQUIRED: SIGN_IN_ONLY,
  TEAMS_LOGIN_REQUIRED: SIGN_IN_ONLY,
  MEETING_ENDED_PREMATURELY: say('The meeting ended before Taro got in.', false),
  BOT_REMOVED_TOO_EARLY: say('Someone removed Taro from the call right after it joined.'),
  RECORDING_RIGHTS_NOT_GRANTED: NO_RECORDING,
  CANNOT_REQUEST_RECORDING_RIGHT: NO_RECORDING,
  STREAMING_SETUP_FAILED: say("Taro couldn't start listening to the call. Send it again."),
  INSUFFICIENT_TOKENS: say('Your MeetingBaas account is out of credit. Add credit in MeetingBaas, then send Taro again.', false),
  FST_ERR_DAILY_BOT_CAP_REACHED: say(
    'Your MeetingBaas account hit its daily limit. Try again tomorrow or raise the limit in MeetingBaas.',
    false
  ),
  INTERNAL_ERROR: STOPPED,
  OOM_KILLED: STOPPED,
  SIGTERM: STOPPED,
  FORCE_KILLED: STOPPED,
  GENERAL_ERROR: STOPPED,
};

/** The sentence for a failed meeting, and whether sending Taro again can help. */
export function explainBotError(code?: string | null, message?: string | null): BotError {
  const known = code ? BY_CODE[code.trim().toUpperCase()] : undefined;
  if (known) return known;
  const text = message?.trim();
  // The API marks meetings that never reached a terminal event as "Abandoned".
  if (!code && text && /^abandoned\b/i.test(text)) return say('Taro never got going in this meeting. Send it again.');
  if (text) return say(text);
  return say("Taro couldn't join this meeting. Send it again.");
}

/** Bot errors where Taro never got past the lobby, which the list calls "Not admitted". */
export const NOT_ADMITTED_CODES: ReadonlySet<string> = new Set(['BOT_NOT_ACCEPTED', 'TIMEOUT_WAITING_TO_START']);
