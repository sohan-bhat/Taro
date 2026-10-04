import Link from 'next/link';
import { HeardText, TranscriptRow } from '@/components/exchange';
import { PrimaryCta } from '@/components/sign-in';
import { Button } from '@/components/ui/button';
import { CLOSING } from './content';
import { C, PAGE_SPLIT } from './grid';

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
                <span className="said text-said-xl font-530 text-white">
                  <HeardText text={CLOSING.said} />
                </span>
              </TranscriptRow>
              <TranscriptRow as="span" who="Taro" taro hideName>
                <span className="text-answer-xl font-750 text-white">{CLOSING.answer}</span>
              </TranscriptRow>
            </h2>
            <div className="ml-14 mt-8 md:ml-28">
              <PrimaryCta variant="inverse" size="lg" className="w-full sm:w-auto" />
              <p className="mt-3.5 max-w-[30em] text-sm text-taro-200">{CLOSING.fine}</p>
            </div>
          </div>
          <div className="self-center py-16 wide:py-24">
            <h2 className="text-[30px] font-750 leading-[1.1] tracking-[-0.025em]">{CLOSING.demoTitle}</h2>
            <p className="mb-[22px] mt-3 max-w-[28em] text-body text-ink-2">{CLOSING.demoBody}</p>
            <Button asChild variant="secondary" size="lg" className="w-full sm:w-auto">
              <Link href="/demo">{CLOSING.demo}</Link>
            </Button>
          </div>
        </div>
      </div>
    </section>
  );
}
