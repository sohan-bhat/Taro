import * as React from 'react';
import Link from 'next/link';
import { TranscriptRow } from '@/components/exchange';
import { PrimaryCta } from '@/components/sign-in';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { HERO } from './content';
import { DingButton } from './ding-button';
import { C, LINE_SPLIT } from './grid';

// "Hey Taro," is the request's first two words. The heard mark sweeps under both once "Taro," fills.
const WAKE_WORDS = 2;

// --i staggers the fill in globals.css: each word lands 220ms after the one before it.
function Word({ i, children }: { i: number; children: string }) {
  return (
    <span className="w" style={{ '--i': i } as React.CSSProperties}>
      {children}
    </span>
  );
}

// Keeps the last word with the one before it, so the answer never ends on a lone "acme/web."
const keepLastWordsTogether = (s: string) => s.replace(/ (?=\S+$)/, '\u00A0');

export function Hero() {
  const words = HERO.request.split(' ');
  return (
    <section aria-labelledby="hero-title" className="pt-7 md:pt-10">
      <div className={C}>
        <p className="mb-[22px] ml-14 text-xs font-medium text-ash md:ml-28 md:text-sm">
          <span className="font-semibold text-ink">{HERO.meeting}</span>
          {` · ${HERO.where}`}
        </p>
        <div className="grid gap-y-1">
          {HERO.context.map((line) => (
            <TranscriptRow key={line.who} who={line.who}>
              <p className="said text-said-lg text-ink-2">{line.said}</p>
            </TranscriptRow>
          ))}
        </div>

        {/* Screen readers hear one sentence. The per-word spans and speaker names stay out of it. */}
        <h1 id="hero-title" className="exchange-hero mt-6">
          <span className="sr-only">{`${HERO.request} ${HERO.answer}`}</span>
          <span aria-hidden="true" className="block">
            <TranscriptRow as="span" who={HERO.asker}>
              <span className="said text-said-hero font-530 text-ink">
                <span className="heard">
                  {words.slice(0, WAKE_WORDS).map((word, i) => (
                    <React.Fragment key={word}>
                      {i > 0 && ' '}
                      <Word i={i}>{word}</Word>
                    </React.Fragment>
                  ))}
                </span>
                {words.slice(WAKE_WORDS).map((word, i) => (
                  <React.Fragment key={word}>
                    {' '}
                    <Word i={WAKE_WORDS + i}>{word}</Word>
                  </React.Fragment>
                ))}
              </span>
            </TranscriptRow>
            <TranscriptRow as="span" who="Taro" taro nameClassName="lands-name" className="mt-4 md:mt-5">
              <span className="lands text-answer font-750 text-ink">{keepLastWordsTogether(HERO.answer)}</span>
            </TranscriptRow>
          </span>
        </h1>

        <div className="ml-14 md:ml-28">
          <DingButton className="lands-late mt-3.5">{HERO.ding}</DingButton>
          <div className={cn(LINE_SPLIT, 'mt-[26px] gap-y-[22px] wide:items-start')}>
            <p className="max-w-measure text-lede text-ink-2">{HERO.lede}</p>
            <div>
              <div className="flex flex-wrap gap-3">
                <PrimaryCta size="lg" className="w-full sm:w-auto" />
                <Button asChild variant="secondary" size="lg" className="w-full sm:w-auto">
                  <Link href="/demo">{HERO.demo}</Link>
                </Button>
              </div>
              <p className="mt-3 text-sm text-ash">{HERO.fine}</p>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
