import Link from 'next/link';
import { Wordmark } from '@/components/brand';
import { Button } from '@/components/ui/button';

// The landing's container, so the wordmark sits where it does on the home page.
const C = 'mx-auto w-full max-w-page px-4 min-[400px]:px-5 md:px-10';
const NAV_LINK = 'min-h-11 items-center rounded-sm text-ui font-medium text-ink-2 hover:text-ink md:min-h-0';

/** The header for pages outside the landing and the app: Sign in and Get started for visitors, Dashboard once signed in. */
export function SiteHeader() {
  return (
    <header className="border-b border-transparent bg-poi">
      <div className={`${C} flex h-[72px] items-center justify-between gap-4`}>
        <Link href="/" aria-label="Taro home" className="rounded-control">
          <Wordmark size="nav" />
        </Link>
        <div className="flex items-center gap-5">
          <Link href="/demo" className={`${NAV_LINK} hidden sm:inline-flex`}>
            Demo
          </Link>
          <Link href="/signin" className={`${NAV_LINK} session-out inline-flex`}>
            Sign in
          </Link>
          <Button asChild size="md" className="session-out">
            <Link href="/signin">Get started</Link>
          </Button>
          <Button asChild size="md" className="session-in">
            <Link href="/dashboard">Dashboard</Link>
          </Button>
        </div>
      </div>
    </header>
  );
}
