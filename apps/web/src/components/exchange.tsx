// The exchange: a person's line in the said face, then Taro's answer in the record face, on one
// transcript grid. Shared by the landing, sign-in, 404, dashboard, and demo. Server components.

import * as React from 'react';
import { sentence } from '@taro/shared';
import { cn } from '@/lib/utils';
import { heardParts } from '@/lib/excerpts';

/** A 44px speaker track with a 12px gap; 88px and 24px from 768px. */
export const TRACK_LG = 'grid grid-cols-[44px_minmax(0,1fr)] items-baseline gap-x-3 md:grid-cols-[88px_minmax(0,1fr)] md:gap-x-6';

/** The sign-in and callback track: 64px and 20px from 768px. */
export const TRACK_COMPACT = 'grid grid-cols-[44px_minmax(0,1fr)] items-baseline gap-x-3 md:grid-cols-[64px_minmax(0,1fr)] md:gap-x-5';

/**
 * One row of the transcript grid: the speaker's name right aligned in the track, then the line.
 * Inside headings pass as="span" (a span with display:grid is valid phrasing content). Screen
 * readers hear "Priya: The export keeps timing out." unless `hideName` hides the name.
 */
export function TranscriptRow({
  who,
  taro = false,
  track = 'lg',
  as: Tag = 'div',
  hideName = false,
  nameClassName,
  className,
  style,
  children,
}: {
  who?: string;
  taro?: boolean;
  track?: 'lg' | 'compact';
  as?: 'div' | 'span' | 'li';
  hideName?: boolean;
  // Extra classes for the name, like the landing's fade-in
  nameClassName?: string;
  className?: string;
  // The landing's live talk sets its timing here, as custom properties
  style?: React.CSSProperties;
  children: React.ReactNode;
}) {
  return (
    <Tag className={cn(track === 'compact' ? TRACK_COMPACT : TRACK_LG, className)} style={style}>
      {who ? (
        <span className={cn('speaker', taro && 'speaker-taro', nameClassName)} aria-hidden={hideName || undefined}>
          {who}
          <span className="sr-only">:</span>
        </span>
      ) : (
        <span aria-hidden="true" />
      )}
      {children}
    </Tag>
  );
}

/** "Hey Taro," or a misheard wake phrase, with the heard mark. Never interactive, never emphasis. */
export function HeyTaro({ children = 'Hey Taro,' }: { children?: React.ReactNode }) {
  return <span className="heard">{children}</span>;
}

/**
 * A person's request as heard: the wake phrase, a space, then the request, ending with punctuation.
 * Renders inline; put it inside an element with the said class and a size, for example
 * <p className="said text-said-req text-ink"><SaidRequest text={view.said} /></p>.
 */
export function SaidRequest({ text, wake = 'Hey Taro,' }: { text: string; wake?: string }) {
  return (
    <>
      <HeyTaro>{wake}</HeyTaro> {sentence(text)}
    </>
  );
}

/** Said text with every wake phrase in it marked: transcript excerpts, full transcripts, live tails. */
export function HeardText({ text }: { text: string }) {
  return (
    <>
      {heardParts(text).map((part, i) =>
        part.heard ? <HeyTaro key={i}>{part.text}</HeyTaro> : <React.Fragment key={i}>{part.text}</React.Fragment>
      )}
    </>
  );
}
