// One request in a meeting: what the person said, Taro's answer, and what came of it.
// Shared with the demo, so nothing here fetches or reads the clock.

import * as React from 'react';
import Link from 'next/link';
import { describeRequest, type RequestLog } from '@/lib/requests';
import { cn } from '@/lib/utils';
import { SaidRequest } from '@/components/exchange';
import { Status } from '@/components/ui/status';
import { Time } from '@/components/ui/time';
import { LINK } from './styles';

export interface RequestRowOptions {
  // The workspace's GitHub actions; older logs need them to tell "Turned off" from "Needs you"
  enabledActions?: readonly string[];
  // While the meeting runs, exceptions read "Needs you" in Taro purple; after, "Needed you"
  live?: boolean;
  // Owners and admins get "Change GitHub permissions" on turned off rows
  canEdit?: boolean;
  // The meeting's transcript, so requests read in the speaker's own words
  transcript?: string;
  // The demo prints every time in one fixed zone
  timeZone?: string;
}

export function RequestRow({ log, enabledActions, live, canEdit, transcript, timeZone }: { log: RequestLog } & RequestRowOptions) {
  const view = describeRequest(log, { enabledActions, live, canEdit, transcript });

  const detail: React.ReactNode[] = [];
  if (view.detail) detail.push(<span key="detail">{view.detail}</span>);
  if (view.branch) {
    detail.push(
      <span key="branch" className="font-mono text-[0.88em] wrap-anywhere">
        {view.branch}
      </span>
    );
  }
  if (view.link) {
    detail.push(
      view.link.external ? (
        <a key="link" href={view.link.href} target="_blank" rel="noreferrer" className={LINK}>
          {view.link.label}
        </a>
      ) : (
        <Link key="link" href={view.link.href} scroll={false} className={LINK}>
          {view.link.label}
        </Link>
      )
    );
  }

  return (
    <li
      id={log._id ? `request-${log._id}` : undefined}
      tabIndex={-1}
      className="grid grid-cols-[64px_minmax(0,1fr)] items-baseline gap-x-4 border-t border-rule-soft py-3.5 first:border-t-0 first:pt-0 focus-visible:outline-offset-[-2px] md:grid-cols-[72px_minmax(0,1fr)_auto]"
    >
      {log.createdAt ? (
        <Time iso={log.createdAt} format="clock" timeZone={timeZone} className="whitespace-nowrap text-sm font-semibold text-ash" />
      ) : (
        <span aria-hidden="true" />
      )}
      <div
        className={cn(
          'min-w-0',
          view.rule === 'attention' && 'border-l-2 border-taro pl-3.5',
          view.rule === 'failed' && 'border-l-2 border-beet pl-3.5'
        )}
      >
        <p className="said text-said-req text-ink">
          <SaidRequest text={view.said} />
        </p>
        <p className="mt-1.5 text-ui font-semibold text-ink">{view.answer}</p>
        {detail.length > 0 && (
          <p className="mt-0.5 text-sm text-ink-2">
            {detail.map((part, i) => (
              <React.Fragment key={i}>
                {i > 0 ? ' · ' : null}
                {part}
              </React.Fragment>
            ))}
          </p>
        )}
        {view.notes.map((note) => (
          <p key={note} className="mt-1 text-meta text-ash">
            {note}
          </p>
        ))}
      </div>
      {view.label && (
        <div className="col-start-2 mt-1.5 md:col-start-3 md:mt-0 md:text-right">
          <Status tone={view.label.tone}>{view.label.text}</Status>
        </div>
      )}
    </li>
  );
}

const byTime = (log: RequestLog) => (log.createdAt ? Date.parse(log.createdAt) : 0);

/**
 * "What people asked for": every request, oldest first. `logs` is null while the meeting loads.
 * The API returns newest first, so the list is sorted here.
 */
export function RequestsSection({ logs, live = false, className, ...options }: { logs: readonly RequestLog[] | null; className?: string } & RequestRowOptions) {
  const ordered = logs ? [...logs].sort((a, b) => byTime(a) - byTime(b)) : null;
  return (
    <section
      aria-labelledby="req-title"
      className={cn('border-b border-rule-soft px-5 py-5 last:border-b-0 md:px-[26px] md:py-[22px]', className)}
    >
      <h3 id="req-title" className="mb-3.5 text-panel-title font-bold text-ink">
        What people asked for
      </h3>
      {!ordered ? (
        <p className="text-meta text-ash">Loading the meeting</p>
      ) : ordered.length === 0 ? (
        <p className="text-sm text-ink-2">
          {live ? 'Nothing asked yet. Say “Hey Taro” and then what you need.' : 'Nobody asked Taro for anything in this meeting.'}
        </p>
      ) : (
        <ol className="list-none">
          {ordered.map((log, i) => (
            <RequestRow key={log._id ?? i} log={log} live={live} {...options} />
          ))}
        </ol>
      )}
    </section>
  );
}
