'use client';

import { useState } from 'react';
import Link from 'next/link';
import { GITHUB_CAPABILITIES } from '@taro/shared';
import { snapshot as rawSnapshot } from '@/demo/snapshot';
import type { DemoDetail, DemoLog, DemoMeeting, DemoSnapshot } from '@/demo/types';
import { GithubMark, SlackMark, Wordmark } from '@/components/brand';
import { Section } from '@/components/paper/tex';
import { SignInWithSlackButton } from '@/components/sign-in';
import { cn } from '@/lib/utils';

const snapshot = rawSnapshot as unknown as DemoSnapshot;

// The page is prerendered, so every date is formatted in one fixed zone; server and browser agree.
const ZONE = 'America/Los_Angeles';
const when = (iso: string) =>
  new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', timeZone: ZONE }).format(new Date(iso));
const day = (iso: string) => new Intl.DateTimeFormat('en-US', { year: 'numeric', month: 'long', day: 'numeric', timeZone: ZONE }).format(new Date(iso));

const STATUS: Record<string, { label: string; tone: string }> = {
  ended: { label: 'ended', tone: 'text-ash' },
  error: { label: 'couldn’t stay', tone: 'text-beet' },
  active: { label: 'live', tone: 'text-ink' },
  joining: { label: 'joining', tone: 'text-taro' },
  pending: { label: 'starting', tone: 'text-taro' },
};
const RESULT: Record<string, { label: string; tone: string }> = {
  success: { label: 'done', tone: 'text-ash' },
  failed: { label: 'failed', tone: 'text-beet' },
  clarification_needed: { label: 'needs you', tone: 'text-taro' },
};

const logsFor = (id: string): DemoLog[] => snapshot.details[id]?.actionLogs ?? [];

// Only meetings where something was heard or asked; the rest are empty test calls.
const meetings: DemoMeeting[] = snapshot.meetings.filter((m) => (m.transcript ?? '').trim() || logsFor(m._id).length > 0);
const featured = meetings.find((m) => logsFor(m._id).some((l) => l.status === 'success')) ?? meetings[0];
const logs = meetings.flatMap((m) => logsFor(m._id));
const done = logs.filter((l) => l.status === 'success').length;

function roomCode(url: string) {
  try {
    return new URL(url).pathname.replace(/^\//, '');
  } catch {
    return url;
  }
}

/** "Opened issue #5 in owner/repo: https://..." becomes the sentence plus a link. */
function Result({ log }: { log: DemoLog }) {
  const text = log.result || log.errorMessage || log.intent.action.replace(/_/g, ' ');
  const match = text.match(/^(.*?):\s*(https?:\/\/\S+)$/);
  if (!match) return <>{text}</>;
  return (
    <>
      {match[1]}.{' '}
      <a href={match[2]} className="tex-link" target="_blank" rel="noreferrer">
        View on GitHub
      </a>
    </>
  );
}

function Detail({ meeting }: { meeting: DemoDetail | DemoMeeting }) {
  const meetingLogs = logsFor(meeting._id);
  return (
    <div className="space-y-5 pb-6 pl-4 pr-1 sm:pl-8">
      <div>
        <h4 className="font-bold">Requests</h4>
        {meetingLogs.length === 0 ? (
          <p className="mt-1 text-ink-2">Nobody asked Taro for anything.</p>
        ) : (
          <ol className="mt-1 space-y-2.5">
            {meetingLogs.map((log, i) => {
              const r = RESULT[log.status] ?? RESULT.failed;
              return (
                <li key={log._id} className="grid grid-cols-[1.6em_minmax(0,1fr)_auto] items-baseline gap-x-3">
                  <span className="text-ash">{i + 1}.</span>
                  <span>
                    “{log.command}”
                    <span className="block text-ink-2">
                      <span aria-hidden className="mr-1.5">→</span>
                      <Result log={log} />
                    </span>
                  </span>
                  <span className={cn('sc whitespace-nowrap text-[1rem]', r.tone)}>{r.label}</span>
                </li>
              );
            })}
          </ol>
        )}
      </div>
      {meeting.transcript && (
        <div>
          <h4 className="font-bold">What Taro heard</h4>
          <p className="mt-1 max-h-44 overflow-y-auto whitespace-pre-wrap italic text-ink-2">{meeting.transcript}</p>
        </div>
      )}
    </div>
  );
}

export default function DemoPage() {
  const [open, setOpen] = useState<string | null>(featured?._id ?? null);
  const gh = snapshot.github;

  return (
    <div className="min-h-screen">
      <header className="mx-auto flex max-w-page items-center justify-between gap-3 px-5 py-4 sm:px-2 sm:py-6">
        <Link href="/" className="rounded-sm">
          <Wordmark />
        </Link>
        <nav aria-label="Demo" className="flex items-center gap-5">
          <Link href="/" className="sc text-[1.0625rem] text-ink-2 hover:text-ink">
            Exit demo
          </Link>
          <SignInWithSlackButton size="sm" compact />
        </nav>
      </header>

      <main id="main" className="sm:px-5">
        <div className="paper mx-auto max-w-page px-5 pb-14 pt-10 sm:rounded-[2px] sm:px-12 sm:shadow-page md:px-[88px] md:pt-14">
          <header className="text-center">
            <h1 className="font-title text-[clamp(1.9rem,1.5rem+1.6vw,2.6rem)] leading-tight">{snapshot.company.name}</h1>
            <p className="mt-1 italic text-ink-2">A real Taro workspace, saved {day(snapshot.capturedAt)}. Nothing here is live.</p>
          </header>

          <section aria-labelledby="summary" className="mx-auto mt-8 max-w-[33rem]">
            <h2 id="summary" className="text-center text-sm font-bold">
              Summary
            </h2>
            <p className="mt-2 text-center">
              Taro joined {meetings.length} meetings here and heard {logs.length} requests. It did {done} of them
              {logs.length > done ? ', and for the rest it asked a question back or said why it couldn’t.' : '.'}
            </p>
          </section>

          <Section n={1} title="Meetings" id="meetings" className="mt-10 md:mt-12">
            <div className="border-y-[1.5px] border-ink">
              <div aria-hidden className="hidden grid-cols-[minmax(0,1fr)_10rem_7.5rem] gap-x-4 border-b border-ink px-1 py-1.5 font-bold sm:grid">
                <span>Meeting</span>
                <span>Started</span>
                <span className="text-right">Status</span>
              </div>
              <ul>
                {meetings.map((m) => {
                  const s = STATUS[m.status] ?? STATUS.ended;
                  const expanded = open === m._id;
                  return (
                    <li key={m._id} className="border-b border-rule last:border-b-0">
                      <button
                        type="button"
                        aria-expanded={expanded}
                        onClick={() => setOpen((cur) => (cur === m._id ? null : m._id))}
                        className="grid w-full grid-cols-[minmax(0,1fr)_auto] items-baseline gap-x-4 px-1 py-3 text-left transition-colors hover:bg-poi focus-visible:bg-poi focus-visible:outline-none sm:grid-cols-[minmax(0,1fr)_10rem_7.5rem]"
                      >
                        <span className="min-w-0">
                          <span className="block truncate">
                            Google Meet <span className="font-mono text-[0.9em] text-ash">{roomCode(m.meetUrl)}</span>
                          </span>
                          <span className="block text-sm text-ash sm:hidden">{when(m.createdAt)}</span>
                        </span>
                        <span className="hidden text-sm text-ink-2 sm:block">{when(m.createdAt)}</span>
                        <span className={cn('sc text-right text-[1rem]', s.tone)}>{s.label}</span>
                      </button>
                      {expanded && <Detail meeting={m} />}
                    </li>
                  );
                })}
              </ul>
            </div>
          </Section>

          <Section n={2} title="Connections" id="connections">
            <div className="border-y-[1.5px] border-ink">
              <div className="grid grid-cols-[minmax(0,1fr)] gap-x-4 border-b border-rule py-3 sm:grid-cols-[9rem_minmax(0,1fr)]">
                <span className="flex items-center gap-2 font-bold sm:font-normal">
                  <SlackMark className="h-4 w-4 shrink-0" />
                  Slack
                </span>
                <span>in {snapshot.slack.teamName}</span>
              </div>
              <div className="grid grid-cols-[minmax(0,1fr)] gap-x-4 py-3 sm:grid-cols-[9rem_minmax(0,1fr)]">
                <span className="flex items-center gap-2 font-bold sm:font-normal">
                  <GithubMark className="h-4 w-4 shrink-0 text-ink" />
                  GitHub
                </span>
                <span>
                  {gh.accountLogin}
                  {gh.repo && <span className="font-mono text-[0.88em] text-ink-2"> {gh.repo}</span>}
                  <span className="block text-sm text-ash">
                    {gh.enabledActions.length} of {GITHUB_CAPABILITIES.length} GitHub actions allowed
                  </span>
                </span>
              </div>
            </div>
            <p className="mt-3 text-sm text-ash">Keys aren’t part of the snapshot.</p>
          </Section>
        </div>
        <p className="py-8 text-center text-sm text-ash">
          Times are Pacific. <Link href="/signin" className="tex-link">Sign in</Link> to set up your own.
        </p>
      </main>
    </div>
  );
}
