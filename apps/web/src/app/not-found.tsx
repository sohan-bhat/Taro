import type { Metadata } from 'next';
import Link from 'next/link';
import { HeyTaro, TranscriptRow } from '@/components/exchange';
import { MissingPath } from '@/components/auth/missing-path';
import { Button } from '@/components/ui/button';
import { SiteHeader } from '@/components/site-header';

export const metadata: Metadata = { title: 'Page not found' };

// The landing's container, so the wordmark and the line track sit where they do on the home page.
const C = 'mx-auto w-full max-w-page px-4 min-[400px]:px-5 md:px-10';

export default function NotFound() {
  return (
    <>
      <SiteHeader />

      <main id="main" className={`${C} pb-24 pt-16 md:pt-24`}>
        {/* Read as one sentence; the speaker names and the two-row picture stay out of the accessibility tree. */}
        <h1>
          <span className="sr-only">
            Hey Taro, open this page. There&apos;s no page at <MissingPath />.
          </span>
          <span aria-hidden="true" className="grid gap-y-4">
            <TranscriptRow as="span" who="You">
              <span className="said text-said-xl font-530 text-ink">
                <HeyTaro /> open this page.
              </span>
            </TranscriptRow>
            <TranscriptRow as="span" who="Taro" taro>
              <span className="text-answer-xl font-750 text-ink">
                There&apos;s no page at <MissingPath className="font-mono text-[0.88em] font-medium wrap-anywhere" />.
              </span>
            </TranscriptRow>
          </span>
        </h1>

        <div className="ml-14 md:ml-28">
          <p className="mt-6 text-body text-ink-2">Check the link, or start from the home page.</p>
          <div className="mt-8 flex flex-wrap gap-3">
            <Button asChild size="lg" className="w-full sm:w-auto">
              <Link href="/">Go to the home page</Link>
            </Button>
            <Button asChild variant="secondary" size="lg" className="w-full sm:w-auto">
              <Link href="/dashboard">Open your dashboard</Link>
            </Button>
          </div>
        </div>
      </main>
    </>
  );
}
