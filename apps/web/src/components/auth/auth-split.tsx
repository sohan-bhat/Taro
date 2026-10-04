import * as React from 'react';
import Link from 'next/link';
import { Wordmark } from '@/components/brand';
import { HeyTaro, TranscriptRow } from '@/components/exchange';

/** Inline text links inside sentences. Nothing else on the site looks like this. */
export const LINK = 'rounded-sm text-taro underline decoration-1 underline-offset-[3px] hover:text-taro-hover hover:decoration-2';

/** The H1 and the body sentence under it, shared by every page in this layout. */
export const AUTH_TITLE = 'text-title font-750';
export const AUTH_BODY = 'mt-3 text-[17px] leading-[1.55] text-ink-2';

/**
 * Sign-in, the auth callback, and the browser connect page: the form on Poi (left from 768px,
 * second on phones), and one exchange on Taro purple (right from 768px, a band on top on phones).
 * The form comes first in the source, so screen readers and the keyboard reach it first.
 */
export function AuthSplit({ children }: { children: React.ReactNode }) {
  return (
    <main id="main" className="grid md:min-h-screen md:grid-cols-2">
      <div className="order-2 flex flex-col bg-poi px-5 pb-12 pt-6 md:order-1 md:min-h-screen md:px-10 md:pt-10">
        <Link href="/" aria-label="Taro home" className="self-start rounded-control">
          <Wordmark size="nav" />
        </Link>
        <div className="mx-auto my-auto w-full max-w-[420px] pt-10 md:pt-0">{children}</div>
      </div>

      {/* No logo on the purple half: Taro is shown by what it does. */}
      <div className="on-taro order-1 flex flex-col justify-center bg-taro px-5 py-7 text-white md:order-2 md:min-h-screen md:px-12 md:py-16 lg:px-16">
        <div className="grid gap-y-2 md:gap-y-4">
          <TranscriptRow who="You" track="compact" hideName>
            <span className="said text-[1.5rem] font-530 leading-[1.15] text-white md:text-said-xl">
              <HeyTaro /> tell engineering the deploy is done.
            </span>
          </TranscriptRow>
          <TranscriptRow who="Taro" taro track="compact" hideName>
            <span className="text-base font-750 leading-[1.2] tracking-[-0.02em] text-white md:text-answer-xl">
              Posted in #engineering.
            </span>
          </TranscriptRow>
        </div>
      </div>
    </main>
  );
}
