import Link from 'next/link';
import * as React from 'react';
import { TranscriptRow } from '@/components/exchange';
import { PrimaryCta } from '@/components/sign-in';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { HERO } from './content';
import { DingButton } from './ding-button';
import { C, LINE } from './grid';
import { keepLastWordsTogether, ms, NAME_BEFORE, speech, Spoken } from './talk';

// 36px on phones to 66px at 1440 (31px below 360px, so each sentence still takes two lines). The
// headline spans the container: at 64px its second line is wider than the line track, so it aligns
// with the wordmark instead.
const H1 =
  'text-pretty text-[clamp(2.125rem,1.5898rem+2.8169vw,4.125rem)] font-750 leading-[1.04] tracking-[-0.035em] max-[359px]:text-[1.9375rem]';

// The largest italic on the page, 30px to 56px, and Taro's answer, 24px to 40px.
const REQUEST = 'said text-[clamp(1.875rem,1.3028rem+2.4413vw,3.5rem)] font-530 leading-[1.08] tracking-[-0.012em] text-ink';
const ANSWER = 'text-[clamp(1.5rem,1.1479rem+1.5023vw,2.5rem)] font-750 leading-[1.12] tracking-[-0.03em] text-ink';

// Each word of line one starts this long after the one before it
const FOCUS_STAGGER = 60;

// The headline's block swipe runs 800ms, so everything after it waits this much longer than it once did
const AFTER_HEADLINE = 400;

const SAID = speech(HERO.request, 950 + AFTER_HEADLINE);

/**
 * The first screen plays as one sequence, in ms from first paint (globals.css has each part's
 * motion). Only the wordmark is there at the start: the problem comes into focus, a block swipes
 * across the answer to reveal it, Sam speaks, Taro answers, and then the rest fades up in a quick
 * stagger. Done in about three and a half seconds.
 */
export const INTRO = {
  problem: 60,
  // The block starts to cover line two as line one's last word comes into focus
  answer: 560,
  context: 750 + AFTER_HEADLINE,
  request: SAID.words[0].at,
  reply: 2350 + AFTER_HEADLINE,
  ding: 2600 + AFTER_HEADLINE,
  // The lede and the buttons arrive as one block
  lede: 2660 + AFTER_HEADLINE,
  buttons: 2660 + AFTER_HEADLINE,
  // The nav's links and sign-in, and everything below the hero
  rest: 2780 + AFTER_HEADLINE,
  // When the last fade-up (320ms) is done
  end: 3100 + AFTER_HEADLINE,
};

export function Hero() {
  return (
    // Plays from first paint; intro-done.tsx ends it at once on any scroll, key, click, or tap
    <section aria-labelledby="hero-title" className="intro pt-9 md:pt-14 wide:pt-[72px]">
      <div className={C}>
        {/* Line one comes into focus word by word, then a block swipes across line two to reveal it.
            The words are split for the motion only, so the heading is named as two plain sentences. */}
        <h1 id="hero-title" className={H1} aria-label={HERO.title.join(' ')}>
          <span className="in-mask text-ash">
            {HERO.title[0].split(' ').map((word, i, all) => (
              <React.Fragment key={i}>
                <span className="in-focus" style={ms({ d: INTRO.problem + i * FOCUS_STAGGER })}>
                  {word}
                </span>
                {i < all.length - 1 ? ' ' : null}
              </React.Fragment>
            ))}
          </span>{' '}
          <span className="in-mask">
            {/* Balanced, so a tablet reads "Taro does them / before you hang up." and not "... before you / hang up." */}
            <span className="in-swipe text-balance text-ink" style={ms({ d: INTRO.answer })}>
              {HERO.title[1]}
            </span>
          </span>
        </h1>

        {/* Screen readers hear the exchange once, as plain sentences */}
        <div className="mt-10 md:mt-12">
          <p className="sr-only">{`${HERO.context.who}: ${HERO.context.said} ${HERO.asker}: ${HERO.request} Taro: ${HERO.answer}`}</p>
          <div aria-hidden="true" className="grid">
            <TranscriptRow who={HERO.context.who} className="in-fade" style={ms({ d: INTRO.context })}>
              <p className="said text-said-lg text-ink-2">{HERO.context.said}</p>
            </TranscriptRow>
            <TranscriptRow
              who={HERO.asker}
              nameClassName="in-fade"
              className="mt-2.5 md:mt-3"
              style={ms({ d: INTRO.request - NAME_BEFORE })}
            >
              <p className={REQUEST}>
                <Spoken text={HERO.request} cues={SAID.words.map((w) => w.at)} unit="ms" wakeAfter={100} />
              </p>
            </TranscriptRow>
            <TranscriptRow who="Taro" taro className="in-land mt-3 md:mt-4" style={ms({ d: INTRO.reply })}>
              <p className={ANSWER}>{keepLastWordsTogether(HERO.answer)}</p>
            </TranscriptRow>
          </div>
          <div className="in-up ml-14 mt-1 md:ml-28 md:mt-2.5" style={ms({ d: INTRO.ding })}>
            <DingButton>{HERO.ding}</DingButton>
          </div>
        </div>

        <div className={cn(LINE, 'mt-7 md:mt-9')}>
          <p className="in-up max-w-[52ch] text-pretty text-lede text-ink-2" style={ms({ d: INTRO.lede })}>
            {HERO.lede}
          </p>
          <div className="in-up mt-6 flex flex-wrap gap-3 md:mt-7" style={ms({ d: INTRO.buttons })}>
            <PrimaryCta size="lg" className="w-full sm:w-auto" />
            <Button asChild variant="secondary" size="lg" className="w-full sm:w-auto">
              <Link href="/demo">{HERO.demo}</Link>
            </Button>
          </div>
        </div>
      </div>
    </section>
  );
}
