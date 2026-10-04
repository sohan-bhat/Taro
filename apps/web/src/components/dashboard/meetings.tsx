'use client';

// The Meetings view: the ways in ("Send Taro to a meeting"), the list, the live slab, and the
// detail panel. Only MeetingSources talks to the API; everything else renders what it's given,
// so the demo can reuse it with a saved snapshot.

import * as React from 'react';
import Link from 'next/link';
import type { Meeting, MeetingDetail, MeetingPlatform } from '@taro/shared';
import { api, ApiError } from '@/lib/api';
import { explainBotError } from '@/lib/bot-errors';
import { daysBefore, formatClock, formatDate, listJoin, meetingTitle, platformLabel, timeAgo, whoAndWhere, type Zone } from '@/lib/format';
import type { TailState } from '@/lib/live-tail';
import {
  isHearing,
  isLive,
  meetingDuration,
  meetingPhase,
  NO_AUDIO,
  rowLineThree,
  rowLineTwo,
  sortMeetings,
  statusPhrase,
  type LineThree,
} from '@/lib/meeting-state';
import { cn } from '@/lib/utils';
import { HeardText } from '@/components/exchange';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Status } from '@/components/ui/status';
import { Segmented } from '@/components/ui/tabs';
import { LiveClock, Time } from '@/components/ui/time';
import { showToast } from '@/components/ui/toast-store';
import { errorText, focusIfLost, useMediaQuery, useNow, useSessionGuard } from './common';
import { RequestsSection } from './request-row';
import { LINK, ROW_BUTTON } from './styles';
import { HeardSection, LiveTail, LiveTranscript } from './transcript';

const INVALID_LINK = 'Paste a Google Meet, Zoom, or Microsoft Teams meeting link.';
const PANEL = 'overflow-hidden rounded-card border border-rule bg-paper';
const SLAB = 'on-taro bg-taro px-5 py-5 text-white md:px-[26px] md:pb-6 md:pt-[22px]';

export interface SendResult {
  meeting: Meeting;
  alreadyActive: boolean;
}

/** The toast after Taro is sent, from the composer or "Send again". */
export function toastSent({ alreadyActive }: Pick<SendResult, 'alreadyActive'>) {
  showToast(alreadyActive ? 'Taro is already in that meeting.' : 'Taro is joining. Admit it from the lobby.');
}

// ---------------------------------------------------------------------------------------------
// Ways in

/**
 * "Send Taro to a meeting": the link form and the Slack line. It is a slot for every way in;
 * `upcoming` is where calendar invitations land when they ship.
 */
export function MeetingSources({
  canJoin,
  missing,
  slackConnected,
  upcoming,
  onSent,
  onNotReady,
  onSetupLink,
}: {
  canJoin: boolean;
  // What sending still needs, in order: "a meeting bot key", "an AI model", "transcription"
  missing: string[];
  slackConnected: boolean;
  upcoming?: React.ReactNode;
  onSent: (result: SendResult) => void;
  // The API answered 412: the workspace changed since the overview loaded
  onNotReady: () => void;
  // "Finish setup" and "Set up Slack" change the view
  onSetupLink?: () => void;
}) {
  const guard = useSessionGuard();
  const roomy = useMediaQuery('(min-width: 640px)');
  const [url, setUrl] = React.useState('');
  const [sending, setSending] = React.useState(false);
  const [fieldError, setFieldError] = React.useState('');
  const [note, setNote] = React.useState<{ tone: 'info' | 'error'; text: string } | null>(null);
  const inputRef = React.useRef<HTMLInputElement>(null);

  const send = async () => {
    const link = url.trim();
    setNote(null);
    if (!link) {
      setFieldError(INVALID_LINK);
      inputRef.current?.focus();
      return;
    }
    setFieldError('');
    setSending(true);
    try {
      const result = await api.meetings.send(link);
      toastSent(result);
      setUrl('');
      onSent(result);
    } catch (error) {
      if (guard(error)) return;
      const status = error instanceof ApiError ? error.status : 0;
      if (status === 400) {
        setFieldError(errorText(error, INVALID_LINK));
        inputRef.current?.focus();
      } else if (status === 429) {
        setNote({ tone: 'info', text: errorText(error, "Taro can't join another meeting right now. Try again later.") });
      } else {
        setNote({ tone: 'error', text: errorText(error, "Taro couldn't join that meeting.") });
        if (status === 412) onNotReady();
      }
    } finally {
      setSending(false);
      // The button was disabled while sending, which drops focus; bring it back to the field.
      focusIfLost('send-link');
    }
  };

  return (
    <section aria-labelledby="send-title" className="rounded-card border border-rule bg-paper p-4 md:p-6">
      <h2 id="send-title" tabIndex={-1} className="text-panel-title font-bold text-ink">
        Send Taro to a meeting
      </h2>
      <form
        noValidate
        className="mt-3.5 flex flex-col gap-2.5 md:flex-row md:items-start"
        onSubmit={(e) => {
          e.preventDefault();
          if (canJoin && !sending) send();
        }}
      >
        <div className="min-w-0 flex-1">
          <Input
            ref={inputRef}
            id="send-link"
            size="lg"
            value={url}
            onChange={(e) => {
              setUrl(e.target.value);
              if (fieldError) setFieldError('');
            }}
            readOnly={sending}
            disabled={!canJoin}
            aria-labelledby="send-title"
            aria-describedby={fieldError ? 'send-error' : 'send-line'}
            aria-invalid={fieldError ? true : undefined}
            inputMode="url"
            autoComplete="off"
            spellCheck={false}
            placeholder={roomy ? 'Paste a Google Meet, Zoom, or Teams link' : 'Paste a Meet, Zoom, or Teams link'}
          />
          {fieldError && (
            <p id="send-error" className="mt-1.5 text-meta text-beet">
              {fieldError}
            </p>
          )}
        </div>
        <Button type="submit" size="lg" disabled={!canJoin} pending={sending} className={ROW_BUTTON}>
          {sending ? 'Sending Taro' : 'Send Taro'}
        </Button>
      </form>
      {note && (
        <Alert tone={note.tone} className="mt-3">
          {note.text}
        </Alert>
      )}
      {!canJoin ? (
        <p id="send-line" className="mt-2.5 text-sm text-ink-2">
          Taro needs {listJoin(missing)} before it can join.{' '}
          <Link href="/dashboard?view=setup" scroll={false} onClick={onSetupLink} className={LINK}>
            Finish setup
          </Link>
          .
        </p>
      ) : slackConnected ? (
        <p id="send-line" className="mt-2.5 text-sm text-ash">
          Or post the link in any Slack channel Taro is in. It replies in the thread.
        </p>
      ) : (
        <p id="send-line" className="mt-2.5 text-sm text-ash">
          Add Taro to Slack and it also joins links posted in your channels.{' '}
          <Link href="/dashboard?view=setup" scroll={false} onClick={onSetupLink} className={LINK}>
            Set up Slack
          </Link>
          .
        </p>
      )}
      {upcoming}
    </section>
  );
}

export interface UpcomingEvent {
  id: string;
  title: string;
  startsAt: string;
  platform?: MeetingPlatform;
  meetUrl: string;
}

/** Reserved for calendar invitations (section 12): meetings Taro is invited to. Renders nothing until there are some. */
export function UpcomingInvites({
  events,
  onSkip,
  timeZone,
}: {
  events: readonly UpcomingEvent[];
  onSkip: (id: string) => void;
  timeZone?: string;
}) {
  if (events.length === 0) return null;
  return (
    <div className="mt-4 border-t border-rule-soft pt-3">
      <h3 className="text-meta font-semibold text-ash">Upcoming</h3>
      <ul className="list-none">
        {events.map((event) => (
          <li key={event.id} className="flex items-center justify-between gap-3 border-b border-rule-soft py-2.5 last:border-b-0">
            <div className="min-w-0">
              <p className="truncate text-ui font-semibold text-ink">{event.title}</p>
              <p className="text-meta text-ash">
                <Time iso={event.startsAt} format="clock" timeZone={timeZone} /> · {platformLabel(event.platform, event.meetUrl)}
              </p>
            </div>
            <Button variant="ghost" size="sm" onClick={() => onSkip(event.id)}>
              Skip
            </Button>
          </li>
        ))}
      </ul>
    </div>
  );
}

// ---------------------------------------------------------------------------------------------
// The list

export type ListMode = 'recent' | 'archive';

const MODES = [
  { value: 'recent', label: 'Recent' },
  { value: 'archive', label: 'Archive' },
] as const;

function StatusWords({ meeting, now, timeZone }: { meeting: Meeting; now: number; timeZone?: string }) {
  const phrase = statusPhrase(meeting, { now, timeZone });
  return (
    <Status tone={phrase.tone} className="shrink-0">
      {phrase.clockSince ? <LiveClock since={phrase.clockSince} prefix="Live " timeZone={timeZone} /> : phrase.text}
    </Status>
  );
}

function RowLineThree({ line }: { line: LineThree }) {
  switch (line.kind) {
    case 'tail':
      return (
        <p className="said truncate text-said-sm text-ink-2">
          <HeardText text={line.text} />
        </p>
      );
    case 'tally':
      return (
        <p className="text-meta text-ink-2">
          {line.parts.map((part, i) => (
            <React.Fragment key={part.text}>
              {i > 0 ? ', ' : null}
              {part.failed ? <span className="font-semibold text-beet">{part.text}</span> : part.text}
            </React.Fragment>
          ))}
        </p>
      );
    case 'error':
      return <p className="line-clamp-2 text-sm text-ink-2">{line.text}</p>;
    default:
      return <p className="text-sm text-ink-2">{line.text}</p>;
  }
}

export function MeetingRow({
  meeting,
  selected,
  href,
  replace,
  onSelect,
  now,
  timeZone,
  maxDurationMs,
}: {
  meeting: Meeting;
  selected: boolean;
  href: string;
  // Two panes: selection is not history. One pane: Back returns to the list.
  replace?: boolean;
  onSelect?: (id: string) => void;
  now: number;
  timeZone?: string;
  // The demo leaves out durations over 3 hours
  maxDurationMs?: number;
}) {
  const { title, code } = meetingTitle(meeting);
  const line3 = rowLineThree(meeting, { now });
  return (
    <li>
      <Link
        id={`meeting-${meeting._id}`}
        href={href}
        replace={replace}
        scroll={false}
        aria-current={selected ? 'true' : undefined}
        onClick={() => onSelect?.(meeting._id)}
        className={cn(
          'block border-b border-rule-soft px-5 py-3.5 transition-colors hover:bg-mist focus-visible:outline-offset-[-2px]',
          selected && 'border-l-[3px] border-l-taro bg-poi pl-[17px] hover:bg-poi'
        )}
      >
        <div className="flex items-baseline justify-between gap-3">
          <p className="min-w-0 truncate text-ui font-semibold text-ink">
            {title}
            {code && <span className="ml-1.5 font-normal text-ash">{code}</span>}
          </p>
          <StatusWords meeting={meeting} now={now} timeZone={timeZone} />
        </div>
        <p className="mt-0.5 truncate text-meta text-ash">{rowLineTwo(meeting, { now, timeZone, maxDurationMs })}</p>
        {line3 && (
          <div className="mt-1.5">
            <RowLineThree line={line3} />
          </div>
        )}
      </Link>
    </li>
  );
}

/**
 * The meetings panel: Recent or Archive, newest first with live meetings on top. `meetings` is
 * null while it loads. Below 1100px live meetings render as cards above it, so `hideLive` leaves
 * them out of the rows.
 */
export function MeetingList({
  meetings,
  mode,
  onModeChange,
  selectedId,
  hrefFor,
  replace,
  hideLive = false,
  onSelect,
  onArchive,
  archiving = false,
  error,
  now,
  timeZone,
  maxDurationMs,
}: {
  meetings: readonly Meeting[] | null;
  mode: ListMode;
  onModeChange?: (mode: ListMode) => void;
  selectedId?: string;
  hrefFor: (id: string) => string;
  replace?: boolean;
  hideLive?: boolean;
  onSelect?: (id: string) => void;
  // "Archive finished meetings"; left out where people can't archive
  onArchive?: () => void;
  archiving?: boolean;
  // Shown in place of the rows when the list couldn't load
  error?: string;
  now: number;
  timeZone?: string;
  maxDurationMs?: number;
}) {
  const sorted = meetings ? sortMeetings(meetings) : null;
  const rows = sorted?.filter((m) => !(hideLive && isLive(m))) ?? null;
  const showFooter = !!onArchive && mode === 'recent' && !!meetings?.some((m) => !isLive(m));

  let body: React.ReactNode = null;
  if (!rows) {
    body = error ? <p className="px-5 py-6 text-sm text-ink-2">{error}</p> : null;
  } else if (meetings && meetings.length === 0) {
    body = (
      <p className="px-5 py-6 text-sm text-ink-2">
        {mode === 'recent'
          ? 'No meetings yet. Paste a link above or post one in Slack, then say “Hey Taro.”'
          : 'Nothing archived yet. Archived meetings stay here for good.'}
      </p>
    );
  } else if (rows.length > 0) {
    body = (
      <ul className={cn('list-none', !showFooter && '[&>li:last-child>a]:border-b-0')}>
        {rows.map((m) => (
          <MeetingRow
            key={m._id}
            meeting={m}
            selected={m._id === selectedId}
            href={hrefFor(m._id)}
            replace={replace}
            onSelect={onSelect}
            now={now}
            timeZone={timeZone}
            maxDurationMs={maxDurationMs}
          />
        ))}
      </ul>
    );
  }

  return (
    <section aria-labelledby="list-title" aria-busy={!rows && !error ? true : undefined} className={PANEL}>
      <div className="flex min-h-[52px] items-center justify-between gap-3 border-b border-rule px-5">
        <h2 id="list-title" tabIndex={-1} className="text-panel-title font-bold text-ink">
          Meetings
        </h2>
        {onModeChange && <Segmented label="Which meetings" options={MODES} value={mode} onChange={onModeChange} />}
      </div>
      {body}
      {showFooter && (
        <div className="px-5 py-3">
          <Button variant="ghost" size="sm" className="-ml-3" onClick={onArchive} pending={archiving}>
            {archiving ? 'Archiving' : 'Archive finished meetings'}
          </Button>
        </div>
      )}
    </section>
  );
}

// ---------------------------------------------------------------------------------------------
// Live meetings

/**
 * A meeting happening now, on the Taro field. `detail` is the top of the detail panel, with
 * the meeting's actions; `card` is the standalone card above the list below 1100px, a link to
 * the meeting.
 */
export function LiveSlab({
  meeting,
  tail,
  botName,
  variant = 'detail',
  href,
  onOpen,
  onLeave,
  leaving = false,
  timeZone,
}: {
  meeting: Meeting;
  tail?: TailState;
  botName: string;
  variant?: 'detail' | 'card';
  href?: string;
  onOpen?: (id: string) => void;
  onLeave?: () => void;
  leaving?: boolean;
  timeZone?: string;
}) {
  const tick = useNow(30_000);
  const phase = meetingPhase(meeting);
  const card = variant === 'card';
  const { code } = meetingTitle(meeting);
  const heading =
    phase === 'live' ? `Live in ${platformLabel(meeting.platform, meeting.meetUrl)}` : phase === 'lobby' ? 'Waiting in the lobby' : 'Starting';
  const meta = whoAndWhere(meeting, phase === 'live' ? 'slab' : 'detail', { timeZone });
  const titleId = card ? `live-${meeting._id}` : 'detail-title';

  let body: React.ReactNode;
  if (phase === 'live') {
    const text = (tail?.text ?? meeting.liveTranscript ?? '').trim();
    body = !isHearing(meeting) ? (
      <p className="mt-[18px] text-base text-white">{NO_AUDIO}</p>
    ) : (
      <>
        <p className="mb-1.5 mt-[18px] text-meta font-semibold text-taro-200">Hearing now</p>
        {text ? (
          <p className="said text-said-body leading-[1.6] text-settle">
            <LiveTail meetingId={meeting._id} state={tail ?? { text, fresh: '', key: text.length }} length={card ? 120 : 240} />
          </p>
        ) : (
          <p className="text-base text-white">Audio is coming through. Words appear as sentences finish.</p>
        )}
      </>
    );
  } else if (phase === 'lobby') {
    body = (
      <>
        <p className="mt-[18px] text-base text-white">
          Admit Taro from the lobby to start. It&apos;s listed as {botName}.
        </p>
        <p className="mt-1 text-sm text-taro-200">Asked to join {timeAgo(meeting.createdAt, tick)}</p>
      </>
    );
  } else {
    body = <p className="mt-[18px] text-base text-white">Taro is on its way to the call.</p>;
  }

  const inner = (
    <>
      <div className="flex items-baseline justify-between gap-4">
        <h2 id={titleId} tabIndex={card ? undefined : -1} className="min-w-0 text-panel-title font-bold">
          {heading}
          {code && <span className="block font-normal text-taro-200 md:ml-1.5 md:inline">{code}</span>}
        </h2>
        {phase === 'live' && (
          <p className="shrink-0 text-2xl font-bold tracking-[-0.01em]">
            <LiveClock since={meeting.startedAt ?? meeting.createdAt} timeZone={timeZone} />
          </p>
        )}
      </div>
      {meta && <p className="mt-1 text-sm text-taro-200">{meta}</p>}
      {body}
    </>
  );

  if (card) {
    return (
      <Link
        id={`meeting-${meeting._id}`}
        href={href ?? '#'}
        scroll={false}
        aria-labelledby={titleId}
        onClick={() => onOpen?.(meeting._id)}
        className={cn(SLAB, 'block rounded-card transition-colors hover:bg-taro-hover')}
      >
        {inner}
      </Link>
    );
  }
  return (
    <div className={SLAB}>
      {inner}
      <div className="mt-[18px] flex flex-wrap gap-2.5">
        <Button asChild variant="inverse" size="sm">
          <a href={meeting.meetUrl} target="_blank" rel="noreferrer">
            Open the meeting
          </a>
        </Button>
        {onLeave && (
          <Button variant="inverseOutline" size="sm" onClick={onLeave} pending={leaving}>
            {leaving ? 'Leaving' : 'Make Taro leave'}
          </Button>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------------------------
// The detail panel

const lowerFirst = (s: string) => s.charAt(0).toLowerCase() + s.slice(1);

// "Ended at 11:42 AM", "Ended yesterday at 11:42 AM", "Ended Sep 30 at 11:42 AM"
function atTime(lead: string, iso: string, now: number, zone: Zone): string {
  const clock = formatClock(iso, zone);
  const days = daysBefore(iso, now, zone);
  if (days <= 0) return `${lead} at ${clock}`;
  if (days === 1) return `${lead} yesterday at ${clock}`;
  return `${lead} ${formatDate(iso, { ...zone, now })} at ${clock}`;
}

/** "Ended at 11:42 AM after 26 min · Ana started it from #design · Archived" */
export function detailMeta(meeting: Meeting, now: number, zone: Zone = {}, maxDurationMs?: number): string {
  const phase = meetingPhase(meeting);
  const duration = meetingDuration(meeting, maxDurationMs);
  const parts: string[] = [];
  if (phase === 'ended') {
    parts.push(meeting.endedAt ? `${atTime('Ended', meeting.endedAt, now, zone)}${duration ? ` after ${lowerFirst(duration)}` : ''}` : 'Ended');
  } else {
    const lead = statusPhrase(meeting, { now, ...zone }).text;
    const long = phase === 'left_early' && duration ? ` after ${lowerFirst(duration)}` : '';
    parts.push(`${atTime(lead, meeting.endedAt ?? meeting.createdAt, now, zone)}${long}`);
  }
  const who = whoAndWhere(meeting, 'detail', zone);
  if (who) parts.push(who);
  if (meeting.archivedAt) parts.push('Archived');
  return parts.join(' · ');
}

/** The selected meeting. Pass `detail` once it loads; `meeting` (from the list) fills in until then. */
export function MeetingDetailPanel({
  meeting,
  detail,
  missing = false,
  tail,
  botName,
  canEdit = false,
  enabledActions,
  onResend,
  resending = false,
  onLeave,
  leaving = false,
  allMeetingsHref,
  onAllMeetings,
  now,
  timeZone,
  maxDurationMs,
  explainMisheard = false,
}: {
  meeting?: Meeting;
  detail?: MeetingDetail | null;
  // The API said 404: deleted, or another workspace's
  missing?: boolean;
  tail?: TailState;
  botName: string;
  canEdit?: boolean;
  enabledActions?: readonly string[];
  // "Send again" on failed meetings; left out where Taro can't be sent
  onResend?: () => void;
  resending?: boolean;
  onLeave?: () => void;
  leaving?: boolean;
  // The link in the not-found state; left out when "All meetings" already sits above the panel
  allMeetingsHref?: string;
  onAllMeetings?: () => void;
  now: number;
  timeZone?: string;
  maxDurationMs?: number;
  // The demo explains that Taro still hears its name when it's misheard
  explainMisheard?: boolean;
}) {
  if (missing) {
    return (
      <section aria-labelledby="detail-title" className={cn(PANEL, 'px-5 py-6 md:px-[26px]')}>
        <h2 id="detail-title" tabIndex={-1} className="text-panel-title font-bold text-ink">
          That meeting isn&apos;t in this workspace.
        </h2>
        {allMeetingsHref && (
          <Button asChild variant="link" size="sm" className="mt-1">
            <Link href={allMeetingsHref} scroll={false} onClick={onAllMeetings}>
              All meetings
            </Link>
          </Button>
        )}
      </section>
    );
  }

  const m = detail ?? meeting;
  if (!m) {
    return (
      <section aria-busy="true" className={cn(PANEL, 'px-5 py-6 md:px-[26px]')}>
        <p className="text-meta text-ash">Loading the meeting</p>
      </section>
    );
  }

  const logs = detail ? detail.actionLogs : null;
  const common = { canEdit, enabledActions, timeZone };

  if (isLive(m)) {
    const liveText = (tail?.text ?? m.liveTranscript ?? '').trim();
    return (
      <section aria-labelledby="detail-title" className={PANEL}>
        <LiveSlab meeting={m} tail={tail} botName={botName} onLeave={onLeave} leaving={leaving} timeZone={timeZone} />
        {m.errorMessage && (
          <div className="px-5 pt-5 md:px-[26px]">
            <Alert tone="info">{m.errorMessage}</Alert>
          </div>
        )}
        <RequestsSection logs={logs} live transcript={m.liveTranscript} {...common} />
        {liveText && <LiveTranscript text={liveText} />}
      </section>
    );
  }

  const { title, code } = meetingTitle(m);
  const failed = m.status === 'error';
  const bot = failed ? explainBotError(m.errorCode, m.errorMessage) : null;
  const text = (m.transcript || m.liveTranscript || '').trim();
  const ran = m.status === 'ended' || !!m.startedAt || !!text || !!logs?.length;

  return (
    <section aria-labelledby="detail-title" className={PANEL}>
      <div className="border-b border-rule px-5 py-5 last:border-b-0 md:px-[26px] md:py-[22px]">
        <h2 id="detail-title" tabIndex={-1} className="text-[22px] font-bold leading-[1.25] tracking-[-0.02em] text-ink">
          {title}
          {code && <span className="ml-1.5 inline-block font-normal text-ash">{code}</span>}
        </h2>
        <p className="mt-1.5 text-[14.5px] text-ink-2">{detailMeta(m, now, { timeZone }, maxDurationMs)}</p>
        {bot ? (
          <Alert tone="error" className="mt-4">
            <p>{bot.sentence}</p>
            {bot.canResend && onResend && (
              <Button size="sm" className="mt-3" onClick={onResend} pending={resending}>
                {resending ? 'Sending Taro' : 'Send again'}
              </Button>
            )}
          </Alert>
        ) : (
          m.errorMessage && (
            <Alert tone="info" className="mt-4">
              {m.errorMessage}
            </Alert>
          )
        )}
      </div>
      {ran && <RequestsSection logs={logs} transcript={text} {...common} />}
      {ran && detail && <HeardSection text={text} logs={detail.actionLogs} timeZone={timeZone} explainMisheard={explainMisheard} />}
    </section>
  );
}
