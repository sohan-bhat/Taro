import Link from 'next/link';
import { HeardText, TranscriptRow } from '@/components/exchange';
import { PrimaryCta } from '@/components/sign-in';
import { Button } from '@/components/ui/button';
import { CLOSING } from './content';
import { C, PAGE_SPLIT } from './grid';
import { KeepCompounds } from './talk';

// 28px to 52px over 20px to 28px: always a little under the hero's request, which stays the largest
// italic on the page, and well over the answer, so the person's line leads.
const SAID = 'said text-balance text-[clamp(1.75rem,1.2218rem+2.2535vw,3.25rem)] font-530 leading-[1.06] tracking-[-0.012em] text-white';
const ANSWER = 'text-balance text-[clamp(1.25rem,1.0739rem+0.7512vw,1.75rem)] font-750 leading-[1.15] tracking-[-0.025em] text-white';

// A diptych that bookends the hero: commit on the Taro field, look around on the right.
export function Closing() {
  return (
    <section aria-label={CLOSING.label} className="mt-[88px] overflow-x-clip wide:mt-[120px]">
      <div className={C}>
        <div className={PAGE_SPLIT}>
          {/* The field runs from the viewport's left edge to the end of the 7 columns (full bleed on phones). The section clips it. */}
          <div className="on-taro relative isolate py-16 text-white before:absolute before:inset-y-0 before:-left-[100vw] before:-right-[100vw] before:-z-10 before:bg-taro wide:py-24 wide:pr-12 wide:before:right-0">
            <h2 className="grid gap-y-4">
              <TranscriptRow as="span" who="You" hideName>
                <span className={SAID}>
                  <HeardText text={CLOSING.said} />
                </span>
              </TranscriptRow>
              <TranscriptRow as="span" who="Taro" taro hideName>
                <span className={ANSWER}>{CLOSING.answer}</span>
              </TranscriptRow>
            </h2>
            <div className="ml-14 mt-8 md:ml-28">
              <PrimaryCta variant="inverse" size="lg" className="w-full sm:w-auto" />
            </div>
          </div>
          <div className="self-center py-16 wide:py-24">
            <h2 className="text-[30px] font-750 leading-[1.1] tracking-[-0.025em]">{CLOSING.demoTitle}</h2>
            <p className="mb-[22px] mt-3 max-w-[28em] text-pretty text-body text-ink-2">
              <KeepCompounds text={CLOSING.demoBody} />
            </p>
            <Button asChild variant="secondary" size="lg" className="w-full sm:w-auto">
              <Link href="/demo">{CLOSING.demo}</Link>
            </Button>
          </div>
        </div>
      </div>
    </section>
  );
}
