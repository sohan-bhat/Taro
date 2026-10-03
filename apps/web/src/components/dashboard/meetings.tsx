'use client';

import { useEffect, useState } from 'react';
import type { Meeting, MeetingDetail } from '@taro/shared';
import { api, ApiError } from '@/lib/api';
import { ACTIVE_STATUSES, listJoin, meetingTitle, timeAgo } from '@/lib/format';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { showToast } from '@/components/ui/toast-store';

// States are words, set in small caps. Color only backs up the word.
const STATUS: Record<Meeting['status'], { label: string; tone: string }> = {
  pending: { label: 'starting', tone: 'text-taro' },
  joining: { label: 'joining', tone: 'text-taro' },
  active: { label: 'live', tone: 'text-ink' },
  ended: { label: 'ended', tone: 'text-ash' },
  error: { label: 'couldn’t stay', tone: 'text-beet' },
};

const RESULT: Record<string, { label: string; tone: string }> = {
  success: { label: 'done', tone: 'text-ash' },
  failed: { label: 'failed', tone: 'text-beet' },
  clarification_needed: { label: 'needs you', tone: 'text-taro' },
};

function isHearing(m: Meeting) {
  return !!m.lastAudioAt && Date.now() - new Date(m.lastAudioAt).getTime() < 15_000;
}

function StatusWord({ status }: { status: Meeting['status'] }) {
  const s = STATUS[status];
  return <span className={cn('sc whitespace-nowrap text-[1rem]', s.tone)}>{s.label}</span>;
}

export function SendToMeeting({ canJoin, missing, onSent }: { canJoin: boolean; missing: string[]; onSent: () => void }) {
  const [url, setUrl] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState('');

  const send = async () => {
    setSending(true);
    setError('');
    try {
      const { alreadyActive } = await api.meetings.send(url.trim());
      showToast(alreadyActive ? 'Taro is already in that meeting.' : 'Taro is joining. Admit it from the lobby.');
      setUrl('');
      onSent();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Taro couldn’t join that meeting.');
    } finally {
      setSending(false);
    }
  };

  return (
    <div>
      <form
        className="flex flex-col gap-3 sm:flex-row sm:items-center"
        onSubmit={(e) => {
          e.preventDefault();
          if (url.trim() && canJoin) send();
        }}
      >
        <label htmlFor="meeting-url" className="sr-only">
          Meeting link
        </label>
        <Input
          id="meeting-url"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          placeholder="Paste a Google Meet, Zoom, or Teams link"
          disabled={!canJoin || sending}
          inputMode="url"
          autoComplete="off"
          spellCheck={false}
          className="sm:flex-1"
        />
        <Button type="submit" disabled={!canJoin || !url.trim() || sending} pending={sending} className="shrink-0">
          {sending ? 'Sending Taro' : 'Send Taro'}
        </Button>
      </form>
      {!canJoin ? (
        <p className="mt-2 text-sm text-ash">First add {listJoin(missing)} in section 2.</p>
      ) : (
        <p className="mt-2 text-sm text-ash">Or post the link in any Slack channel Taro is in.</p>
      )}
      {error && <p className="mt-2 border-l-[3px] border-beet pl-3 text-sm">{error}</p>}
    </div>
  );
}

function Subhead({ children }: { children: React.ReactNode }) {
  return <h4 className="font-bold text-ink">{children}</h4>;
}

function MeetingDetailPanel({ meeting, onLeft }: { meeting: Meeting; onLeft: () => void }) {
  const [detail, setDetail] = useState<MeetingDetail | null>(null);
  const [leaving, setLeaving] = useState(false);
  const live = ACTIVE_STATUSES.has(meeting.status);

  useEffect(() => {
    let cancelled = false;
    const load = () =>
      api.meetings
        .get(meeting._id)
        .then(({ meeting: d }) => !cancelled && setDetail(d))
        .catch(() => {});
    load();
    const timer = live ? setInterval(load, 4000) : undefined;
    return () => {
      cancelled = true;
      if (timer) clearInterval(timer);
    };
  }, [meeting._id, live]);

  const leave = async () => {
    setLeaving(true);
    try {
      await api.meetings.leave(meeting._id);
      showToast('Taro left the meeting.');
      onLeft();
    } catch (e) {
      showToast(e instanceof ApiError ? e.message : 'Couldn’t reach the meeting bot.', 'error');
    } finally {
      setLeaving(false);
    }
  };

  if (!detail) return <p className="pb-5 pl-4 text-sm text-ash sm:pl-8">Loading…</p>;

  return (
    <div className="space-y-5 pb-6 pl-4 pr-1 sm:pl-8">
      {detail.errorMessage && (
        <p className={cn('border-l-[3px] pl-3 text-sm', detail.status === 'error' ? 'border-beet' : 'border-taro')}>
          {detail.errorMessage}
        </p>
      )}

      {live && (
        <div>
          <Subhead>Hearing now</Subhead>
          <p className="mt-1 max-h-36 overflow-y-auto whitespace-pre-wrap italic text-ink-2">
            {detail.liveTranscript ||
              (isHearing(detail) ? 'Audio is coming through. Words appear as sentences finish.' : 'No audio yet. If Taro is in the lobby, admit it.')}
          </p>
        </div>
      )}

      <div>
        <Subhead>Requests</Subhead>
        {detail.actionLogs.length === 0 ? (
          <p className="mt-1 text-ink-2">{live ? 'Nothing yet. Say “Hey Taro” and a request.' : 'Nobody asked Taro for anything.'}</p>
        ) : (
          <ol className="mt-1 space-y-2.5">
            {detail.actionLogs.map((log, i) => {
              const result = RESULT[log.status] ?? RESULT.failed;
              const reason = log.intent.params?.reason;
              return (
                <li key={log._id} className="grid grid-cols-[1.6em_minmax(0,1fr)_auto] items-baseline gap-x-3">
                  <span className="text-ash">{i + 1}.</span>
                  <span>
                    <span>“{log.command}”</span>
                    <span className="block text-ink-2">
                      <span aria-hidden className="mr-1.5">→</span>
                      {log.result || log.errorMessage || reason || log.intent.action.replace(/_/g, ' ')}
                    </span>
                    {log.intent.source === 'fallback_regex' && log.status !== 'success' && (
                      <span className="block text-sm text-ash">The AI model was unavailable for this one.</span>
                    )}
                  </span>
                  <span className={cn('sc whitespace-nowrap text-[1rem]', result.tone)}>{result.label}</span>
                </li>
              );
            })}
          </ol>
        )}
      </div>

      {!live && detail.transcript && (
        <div>
          <Subhead>What Taro heard</Subhead>
          <p className="mt-1 max-h-44 overflow-y-auto whitespace-pre-wrap italic text-ink-2">{detail.transcript}</p>
        </div>
      )}

      {live && (
        <Button variant="destructive" size="sm" onClick={leave} pending={leaving}>
          {leaving ? 'Leaving' : 'Make Taro leave'}
        </Button>
      )}
    </div>
  );
}

function MeetingRow({ meeting, expanded, onToggle, onChanged }: { meeting: Meeting; expanded: boolean; onToggle: () => void; onChanged: () => void }) {
  const live = meeting.status === 'active';
  const { title, code } = meetingTitle(meeting);
  return (
    <li className="border-b border-rule last:border-b-0">
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={expanded}
        className="grid w-full grid-cols-[minmax(0,1fr)_auto] items-baseline gap-x-4 px-1 py-3 text-left transition-colors hover:bg-poi focus-visible:bg-poi focus-visible:outline-none sm:grid-cols-[minmax(0,1fr)_11rem_7.5rem]"
      >
        <span className="min-w-0">
          <span className="block truncate">
            {title}
            {code && <span className="font-mono text-[0.9em] text-ash"> {code}</span>}
          </span>
          <span className="block truncate text-sm text-ash sm:hidden">
            {timeAgo(meeting.createdAt)}
            {meeting.startedByName && <> by {meeting.startedByName}</>}
          </span>
        </span>
        <span className="hidden truncate text-sm text-ink-2 sm:block">
          {timeAgo(meeting.createdAt)}
          {meeting.startedByName && <> by {meeting.startedByName}</>}
        </span>
        <span className="text-right">
          <StatusWord status={meeting.status} />
          {live && <span className="block text-xs text-ash">{isHearing(meeting) ? 'hearing audio' : 'waiting for audio'}</span>}
        </span>
      </button>
      {expanded && <MeetingDetailPanel meeting={meeting} onLeft={onChanged} />}
    </li>
  );
}

function MeetingTable({ meetings, expanded, onToggle, onChanged }: { meetings: Meeting[]; expanded: string | null; onToggle: (id: string) => void; onChanged: () => void }) {
  return (
    <div className="border-y-[1.5px] border-ink">
      <div aria-hidden className="hidden grid-cols-[minmax(0,1fr)_11rem_7.5rem] gap-x-4 border-b border-ink px-1 py-1.5 font-bold sm:grid">
        <span>Meeting</span>
        <span>Started</span>
        <span className="text-right">Status</span>
      </div>
      <ul>
        {meetings.map((m) => (
          <MeetingRow key={m._id} meeting={m} expanded={expanded === m._id} onToggle={() => onToggle(m._id)} onChanged={onChanged} />
        ))}
      </ul>
    </div>
  );
}

export function MeetingsSection({ meetings, onChanged }: { meetings: Meeting[]; onChanged: () => void }) {
  const [expanded, setExpanded] = useState<string | null>(null);
  const [showArchive, setShowArchive] = useState(false);
  const [archived, setArchived] = useState<Meeting[]>([]);
  const [clearing, setClearing] = useState(false);

  const loadArchive = () =>
    api.meetings
      .list(true)
      .then(({ meetings }) => setArchived(meetings))
      .catch(() => {});

  const finished = meetings.filter((m) => !ACTIVE_STATUSES.has(m.status)).length;

  const clear = async () => {
    setClearing(true);
    try {
      const { archived: n } = await api.meetings.clearHistory();
      showToast(n === 0 ? 'Nothing to archive.' : `Archived ${n} meeting${n === 1 ? '' : 's'}.`);
      onChanged();
      if (showArchive) loadArchive();
    } catch (e) {
      showToast(e instanceof ApiError ? e.message : 'Couldn’t archive meetings.', 'error');
    } finally {
      setClearing(false);
    }
  };

  const toggle = (id: string) => setExpanded((cur) => (cur === id ? null : id));

  return (
    <div>
      {meetings.length === 0 ? (
        <p className="border-y-[1.5px] border-ink py-8 text-center text-ink-2">No meetings yet. Paste a link above, or post one in Slack.</p>
      ) : (
        <MeetingTable meetings={meetings} expanded={expanded} onToggle={toggle} onChanged={onChanged} />
      )}

      <div className="mt-3 flex flex-wrap items-center gap-x-6 gap-y-1">
        <Button
          variant="link"
          size="sm"
          onClick={() => {
            const next = !showArchive;
            setShowArchive(next);
            if (next) loadArchive();
          }}
        >
          {showArchive ? 'Hide the archive' : 'Show the archive'}
        </Button>
        {finished > 0 && (
          <Button variant="link" size="sm" onClick={clear} pending={clearing}>
            {clearing ? 'Archiving' : 'Archive finished meetings'}
          </Button>
        )}
      </div>

      {showArchive && (
        <div className="mt-5">
          <h3 className="mb-2 font-bold">Archive</h3>
          {archived.length === 0 ? (
            <p className="text-ink-2">Empty. Archived meetings are kept, never deleted.</p>
          ) : (
            <MeetingTable meetings={archived} expanded={expanded} onToggle={toggle} onChanged={onChanged} />
          )}
        </div>
      )}
    </div>
  );
}
