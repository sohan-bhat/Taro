/**
 * The few Google endpoints Connect Google Calendar uses, over plain fetch: the OAuth token exchange
 * and refresh, revocation, and the Calendar API's events list, watch, and channel stop. Read only:
 * nothing here can change a calendar. Tokens go to Google and nowhere else, and never into a log
 * line or an error message.
 */

import { env } from '../../config/env';

export const CALENDAR_SCOPE = 'https://www.googleapis.com/auth/calendar.events.readonly';
// openid and email say which Google account was connected, so Setup can show it.
export const CONNECT_SCOPES = ['openid', 'email', CALENDAR_SCOPE];

const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const REVOKE_URL = 'https://oauth2.googleapis.com/revoke';
const CALENDAR_API = 'https://www.googleapis.com/calendar/v3';
const TIMEOUT_MS = 15_000;
// Everything Taro reads from an event. maxAttendees=1 makes Google return only the person's own
// attendee entry, so other guests never reach Taro at all.
const EVENT_FIELDS =
  'nextPageToken,items(id,iCalUID,status,eventType,summary,start,end,originalStartTime,recurringEventId,' +
  'hangoutLink,conferenceData/entryPoints(entryPointType,uri),location,description,organizer(email,self),attendees(self,responseStatus),attendeesOmitted)';

export const redirectUri = () => `${env.apiUrl}/api/auth/google/callback`;

/** A call to Google failed. `reason` is Google's own short code when it gave one. */
export class GoogleApiError extends Error {
  constructor(
    message: string,
    public status?: number,
    public reason?: string
  ) {
    super(message);
    this.name = 'GoogleApiError';
  }
}

/** Google won't honor the grant any more: the person revoked it, it expired, or it lost the calendar scope. Only reconnecting fixes it. */
export class GoogleGrantRevoked extends Error {
  constructor(public why: 'invalid_grant' | 'scope') {
    super(why === 'scope' ? "Google's grant no longer covers reading the calendar" : 'Google says the grant was revoked or expired');
    this.name = 'GoogleGrantRevoked';
  }
}

/** The granted scopes, as Google lists them (space separated), include reading calendar events. */
export function hasCalendarScope(scope: unknown): boolean {
  return typeof scope === 'string' && scope.split(/\s+/).includes(CALENDAR_SCOPE);
}

const reasonOf = (body: unknown): string | undefined => {
  const error = (body as { error?: unknown } | null)?.error;
  if (typeof error === 'string') return error.slice(0, 80);
  const first = (error as { errors?: Array<{ reason?: unknown }> } | undefined)?.errors?.[0]?.reason;
  return typeof first === 'string' ? first.slice(0, 80) : undefined;
};

async function readJson(res: Response): Promise<unknown> {
  return res.json().catch(() => ({}));
}

async function tokenRequest(params: Record<string, string>): Promise<Record<string, unknown>> {
  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
    body: new URLSearchParams({ client_id: env.googleClientId, client_secret: env.googleClientSecret, ...params }),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  const body = (await readJson(res)) as Record<string, unknown>;
  if (!res.ok) {
    const reason = reasonOf(body);
    if (reason === 'invalid_grant') throw new GoogleGrantRevoked('invalid_grant');
    throw new GoogleApiError(`Google's token endpoint answered ${res.status}${reason ? ` (${reason})` : ''}`, res.status, reason);
  }
  return body;
}

export interface CodeExchange {
  accessToken: string;
  refreshToken?: string;
  idToken?: string;
  scope: string;
}

/** Trades the code from the consent screen for tokens. */
export async function exchangeCode(code: string): Promise<CodeExchange> {
  const body = await tokenRequest({ code, redirect_uri: redirectUri(), grant_type: 'authorization_code' });
  if (typeof body.access_token !== 'string') throw new GoogleApiError("Google's token endpoint sent no access token");
  return {
    accessToken: body.access_token,
    refreshToken: typeof body.refresh_token === 'string' ? body.refresh_token : undefined,
    idToken: typeof body.id_token === 'string' ? body.id_token : undefined,
    scope: typeof body.scope === 'string' ? body.scope : '',
  };
}

export interface AccessToken {
  accessToken: string;
  expiresInS: number;
  scope?: string;
}

/** A fresh access token from the stored refresh token. Throws GoogleGrantRevoked when Google refuses the grant. */
export async function refreshAccessToken(refreshToken: string): Promise<AccessToken> {
  const body = await tokenRequest({ refresh_token: refreshToken, grant_type: 'refresh_token' });
  if (typeof body.access_token !== 'string') throw new GoogleApiError("Google's token endpoint sent no access token");
  const expires = Number(body.expires_in);
  return {
    accessToken: body.access_token,
    expiresInS: Number.isFinite(expires) && expires > 0 ? expires : 3600,
    scope: typeof body.scope === 'string' ? body.scope : undefined,
  };
}

/** Revokes the grant at Google. A token Google already forgot counts as revoked. */
export async function revokeToken(token: string): Promise<void> {
  const res = await fetch(REVOKE_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ token }),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (res.ok) return;
  const reason = reasonOf(await readJson(res));
  if (res.status === 400 && (reason === 'invalid_token' || reason === 'invalid_grant')) return;
  throw new GoogleApiError(`Google's revoke endpoint answered ${res.status}${reason ? ` (${reason})` : ''}`, res.status, reason);
}

async function calendarCall(accessToken: string, path: string, init: { method?: string; body?: unknown } = {}): Promise<unknown> {
  const res = await fetch(`${CALENDAR_API}${path}`, {
    method: init.method ?? 'GET',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      Accept: 'application/json',
      ...(init.body === undefined ? {} : { 'Content-Type': 'application/json' }),
    },
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (res.status === 204) return {};
  const body = await readJson(res);
  if (!res.ok) {
    const reason = reasonOf(body);
    throw new GoogleApiError(`Google Calendar answered ${res.status}${reason ? ` (${reason})` : ''}`, res.status, reason);
  }
  return body;
}

export interface EventPage {
  items: unknown[];
  nextPageToken?: string;
}

/**
 * One page of the primary calendar's events that end after `from` and start before `to`, recurring
 * meetings expanded into their occurrences, soonest first. Ordinary events only: no focus time, out
 * of office, working location, birthdays, or events Gmail made.
 */
export async function listEvents(accessToken: string, window: { from: Date; to: Date }, pageToken?: string): Promise<EventPage> {
  const params = new URLSearchParams({
    timeMin: window.from.toISOString(),
    timeMax: window.to.toISOString(),
    singleEvents: 'true',
    orderBy: 'startTime',
    showDeleted: 'false',
    eventTypes: 'default',
    maxResults: '250',
    maxAttendees: '1',
    fields: EVENT_FIELDS,
  });
  if (pageToken) params.set('pageToken', pageToken);
  const body = (await calendarCall(accessToken, `/calendars/primary/events?${params}`)) as { items?: unknown; nextPageToken?: unknown };
  return {
    items: Array.isArray(body.items) ? body.items : [],
    nextPageToken: typeof body.nextPageToken === 'string' && body.nextPageToken ? body.nextPageToken : undefined,
  };
}

export interface WatchChannel {
  resourceId: string;
  expiresAt: Date;
}

/** Asks Google to tell `address` whenever the primary calendar's events change. Notifications carry no event data. */
export async function watchEvents(
  accessToken: string,
  channel: { id: string; token: string; address: string; ttlSeconds: number }
): Promise<WatchChannel> {
  const body = (await calendarCall(accessToken, '/calendars/primary/events/watch?eventTypes=default', {
    method: 'POST',
    body: { id: channel.id, type: 'web_hook', address: channel.address, token: channel.token, params: { ttl: String(channel.ttlSeconds) } },
  })) as { resourceId?: unknown; expiration?: unknown };
  const expiration = Number(body.expiration);
  if (typeof body.resourceId !== 'string' || !body.resourceId) throw new GoogleApiError('Google opened a channel without a resource ID');
  return {
    resourceId: body.resourceId.slice(0, 256),
    expiresAt: new Date(Number.isFinite(expiration) && expiration > 0 ? expiration : Date.now() + channel.ttlSeconds * 1000),
  };
}

/** Closes a push channel. One Google no longer knows is already closed. */
export async function stopChannel(accessToken: string, channel: { id: string; resourceId: string }): Promise<void> {
  try {
    await calendarCall(accessToken, '/channels/stop', { method: 'POST', body: { id: channel.id, resourceId: channel.resourceId } });
  } catch (error) {
    if (error instanceof GoogleApiError && error.status === 404) return;
    throw error;
  }
}
