'use client';

// What Taro heard: excerpts around each request, the full text on request, and the live tail
// with its newest words. Every wake phrase carries the heard mark; nothing here is interactive
// except the show and hide buttons.

import * as React from 'react';
import { cutHead, excerpts, hasMisheardWake, heardParts, type ExcerptLog } from '@/lib/excerpts';
import { tailParts, type TailState } from '@/lib/live-tail';
import { HeardText, HeyTaro } from '@/components/exchange';
import { Button } from '@/components/ui/button';
import { Time } from '@/components/ui/time';

const SAID_BODY = 'said max-w-transcript text-said-body text-ink-2';
const ROW = 'grid grid-cols-[64px_minmax(0,1fr)] items-baseline gap-x-4 md:grid-cols-[72px_minmax(0,1fr)]';
// Text shown when there are no located requests
const HEAD_LENGTH = 600;

/**
 * The end of a live transcript: the last `length` characters cut at a word, with the words that
 * arrived since the last poll in `.fresh`. The fresh span is keyed by arrival, so its settle
 * animation runs once per arrival and never restarts on an unchanged poll.
 */
export function LiveTail({ meetingId, state, length }: { meetingId: string; state: TailState; length: number }) {
  const { settled, fresh } = tailParts(state, length);
  const boundary = settled.length;
  const before: React.ReactNode[] = [];
  const after: React.ReactNode[] = [];
  let at = 0;
  // Marks come from the whole tail, so a wake phrase split by the fresh edge still reads as one band.
  heardParts(settled + fresh).forEach((part, i) => {
    const end = at + part.text.length;
    const pieces: Array<[string, React.ReactNode[]]> = [];
    if (at < boundary) pieces.push([part.text.slice(0, Math.max(0, boundary - at)), before]);
    if (end > boundary) pieces.push([part.text.slice(Math.max(0, boundary - at)), after]);
    pieces.forEach(([text, into], j) => {
      if (text) into.push(part.heard ? <HeyTaro key={`${i}.${j}`}>{text}</HeyTaro> : <React.Fragment key={`${i}.${j}`}>{text}</React.Fragment>);
    });
    at = end;
  });
  return (
    <>
      {before}
      {after.length > 0 && (
        <span key={`${meetingId}:${state.key}`} className="fresh">
          {after}
        </span>
      )}
    </>
  );
}

/** A live meeting's whole transcript so far, behind "Show everything heard so far". */
export function LiveTranscript({ text }: { text: string }) {
  const [open, setOpen] = React.useState(false);
  const id = React.useId();
  return (
    <div className="px-5 py-4 md:px-[26px] md:pb-5">
      {open && (
        <p id={id} className={`${SAID_BODY} mb-2 whitespace-pre-wrap`}>
          <HeardText text={text} />
        </p>
      )}
      <Button variant="link" size="sm" aria-expanded={open} aria-controls={open ? id : undefined} onClick={() => setOpen((o) => !o)}>
        {open ? 'Show less' : 'Show everything heard so far'}
      </Button>
    </div>
  );
}

/**
 * "What Taro heard" for meetings that ran. Excerpts around each request by default, the whole
 * text on request. `explainMisheard` adds the demo's line about misheard wake phrases.
 */
export function HeardSection({
  text,
  logs,
  timeZone,
  explainMisheard = false,
}: {
  text: string;
  logs: readonly ExcerptLog[];
  timeZone?: string;
  explainMisheard?: boolean;
}) {
  const [full, setFull] = React.useState(false);
  const body = text.trim();
  const found = React.useMemo(() => (body ? excerpts(body, logs) : []), [body, logs]);
  const head = React.useMemo(() => cutHead(body, HEAD_LENGTH), [body]);
  const fullId = React.useId();

  // Excerpts that already show every word make the full text a repeat.
  const coversAll = found.length === 1 && found[0].start === 0 && found[0].end >= body.length;
  const canExpand = found.length > 0 ? !coversAll : head.cut;

  let content: React.ReactNode;
  if (!body) {
    content = (
      <p className="mt-1 text-sm text-ink-2">
        {logs.length ? 'Taro has no transcript for this meeting.' : "Taro didn't hear any speech in this meeting."}
      </p>
    );
  } else if (full) {
    content = (
      <p id={fullId} className={`${SAID_BODY} mt-4 whitespace-pre-wrap`}>
        <HeardText text={body} />
      </p>
    );
  } else if (found.length > 0) {
    content = (
      <>
        <p className="mt-1 text-sm text-ink-2">The moments around each request.</p>
        <ol className="mt-4 grid list-none gap-4">
          {found.map((excerpt) => (
            <li key={excerpt.start} className={ROW}>
              {excerpt.at ? (
                <Time iso={excerpt.at} format="clock" timeZone={timeZone} className="whitespace-nowrap text-sm font-semibold text-ash" />
              ) : (
                <span aria-hidden="true" />
              )}
              <p className={SAID_BODY}>
                {excerpt.cutBefore ? '…' : null}
                <HeardText text={excerpt.text} />
              </p>
            </li>
          ))}
        </ol>
      </>
    );
  } else {
    content = (
      <p className={`${SAID_BODY} mt-4 whitespace-pre-wrap`}>
        <HeardText text={head.text} />
      </p>
    );
  }

  return (
    <section aria-labelledby="heard-title" className="px-5 py-5 md:px-[26px] md:py-[22px]">
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <h3 id="heard-title" className="text-panel-title font-bold text-ink">
          What Taro heard
        </h3>
        <p className="text-meta text-ash">Text only. Audio isn&apos;t saved.</p>
      </div>
      {content}
      {body && canExpand && (
        <div className="mt-3">
          <Button
            variant="link"
            size="sm"
            aria-expanded={full}
            aria-controls={full ? fullId : undefined}
            onClick={() => setFull((f) => !f)}
          >
            {full ? 'Show less' : 'Show the full transcript'}
          </Button>
        </div>
      )}
      {explainMisheard && body && hasMisheardWake(body) && (
        <p className="mt-3 text-meta text-ash">Taro listens for its name even when it&apos;s misheard.</p>
      )}
    </section>
  );
}
