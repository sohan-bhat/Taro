// Small, faithful pictures of Slack for the landing page. Never tinted purple: Slack's own colors
// and Lato, and only the parts Taro's messages touch. The text comes from the shared copy deck.

import * as React from 'react';
import { Mark } from '@/components/brand';
import { cn } from '@/lib/utils';

const FRAME = 'm-0 min-w-0 overflow-hidden rounded-card border border-rule bg-paper shadow-artifact font-slack text-slack-text';

// Slack's muted avatar colors for the people in the meeting
const AVATAR: Record<string, string> = {
  Priya: 'bg-[#8A5A2B]',
  Sam: 'bg-[#2F6B5E]',
  Ana: 'bg-[#3D5A8A]',
  Dev: 'bg-[#7A3D5A]',
};

// The mrkdwn Taro posts: *bold*, _italic_, <url|text> and <url> links, and line breaks.
const TOKEN = /(\*[^*\n]+\*|_[^_\n]+_|<[^<>|\s]+(?:\|[^<>]+)?>|\n)/;

export function Mrkdwn({ text }: { text: string }) {
  return (
    <>
      {text.split(TOKEN).map((part, i) => {
        // split keeps each matched token at an odd index
        if (i % 2 === 0) return part;
        if (part === '\n') return <br key={i} />;
        const inner = part.slice(1, -1);
        if (part[0] === '*') return <b key={i} className="font-bold">{inner}</b>;
        if (part[0] === '_') return <i key={i}>{inner}</i>;
        const [url, label] = inner.split('|');
        // A picture of a link: it looks like Slack's and goes nowhere
        return (
          <span key={i} className="text-slack-link">
            {label ?? url}
          </span>
        );
      })}
    </>
  );
}

/** A channel, or the thread pane Slack opens beside it. */
export function SlackCard({
  channel,
  thread = false,
  caption,
  children,
}: {
  channel: string;
  thread?: boolean;
  caption: string;
  children: React.ReactNode;
}) {
  return (
    <figure className={FRAME}>
      <figcaption className="sr-only">{caption}</figcaption>
      {thread ? (
        <div className="flex items-baseline gap-1.5 border-b border-slack-border px-[18px] py-[11px]">
          <span className="text-[15px] font-black">Thread</span>
          <span className="text-[13px] text-slack-muted">{`# ${channel}`}</span>
        </div>
      ) : (
        <div className="border-b border-slack-border px-[18px] py-[11px] text-[15px] font-black">{`# ${channel}`}</div>
      )}
      <div className="py-1.5">{children}</div>
    </figure>
  );
}

export function SlackMessage({ who, time, text, taro = false }: { who: string; time: string; text: string; taro?: boolean }) {
  return (
    <div className="grid grid-cols-[36px_minmax(0,1fr)] gap-2 px-[18px] py-2.5">
      {taro ? (
        <span aria-hidden="true" className="grid h-9 w-9 place-items-center rounded-[8px] bg-taro">
          <Mark height={21} tone="poi" />
        </span>
      ) : (
        <span
          aria-hidden="true"
          className={cn(
            'grid h-9 w-9 place-items-center rounded-[8px] text-[15px] font-bold text-white',
            AVATAR[who.split(' ')[0]] ?? 'bg-slack-muted'
          )}
        >
          {who[0]}
        </span>
      )}
      <div className="min-w-0">
        <p className="leading-[22px]">
          <span className="text-[15px] font-black">{who}</span>
          {taro && (
            <span className="ml-1 rounded-[3px] bg-slack-badge px-[3px] py-px align-[1px] text-[10px] font-bold leading-none text-slack-muted">
              APP
            </span>
          )}
          <span className="ml-1.5 text-xs text-slack-muted">{time}</span>
        </p>
        <div className="text-[15px] leading-[22px] wrap-anywhere">
          <Mrkdwn text={text} />
        </div>
      </div>
    </div>
  );
}

/** "1 reply" and Slack's hairline, between a message and its thread. */
export function SlackDivider({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-3 px-[18px] py-1 text-[13px] text-slack-muted">
      <span>{children}</span>
      <span aria-hidden="true" className="h-px flex-1 bg-slack-border" />
    </div>
  );
}
