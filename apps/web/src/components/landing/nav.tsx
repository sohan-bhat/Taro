'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { Wordmark } from '@/components/brand';
import { PrimaryCta } from '@/components/sign-in';
import { cn } from '@/lib/utils';
import { C } from './grid';

const SENTINEL_ID = 'nav-sentinel';

/**
 * Goes first in <main>. It sits 8px down the page (nothing above it is positioned), so it leaves the
 * viewport as soon as the page scrolls past 8px.
 */
export function NavSentinel() {
  return <div id={SENTINEL_ID} aria-hidden="true" className="pointer-events-none absolute left-0 top-2 h-px w-px" />;
}

const LINK = 'rounded-sm text-ui font-medium text-ink-2 transition-colors duration-120 hover:text-ink';

export function Nav({ sections, demo }: { sections: ReadonlyArray<{ label: string; href: string }>; demo: string }) {
  const [scrolled, setScrolled] = useState(false);

  // The rule under the nav appears only once the page scrolls beneath it. An observer, not a scroll listener.
  useEffect(() => {
    const sentinel = document.getElementById(SENTINEL_ID);
    if (!sentinel || typeof IntersectionObserver === 'undefined') return;
    const observer = new IntersectionObserver(([entry]) => setScrolled(!entry.isIntersecting));
    observer.observe(sentinel);
    return () => observer.disconnect();
  }, []);

  return (
    <header
      data-scrolled={scrolled}
      className="sticky top-0 z-40 border-b border-transparent bg-poi transition-colors duration-120 data-[scrolled=true]:border-rule"
    >
      <div className={cn(C, 'flex h-[72px] items-center justify-between gap-4')}>
        {/* On phones the padding (cancelled by the margin) makes a 45px tap target without moving the wordmark */}
        <Link href="/" aria-label="Taro home" className="-my-[5px] rounded-control py-[5px] md:my-0 md:py-0">
          <Wordmark size="nav" />
        </Link>
        {/* The links and sign-in arrive with the hero's buttons (intro-late); the wordmark is there from the start */}
        <nav aria-label="Sections" className="intro-late hidden items-center gap-7 wide:flex">
          {sections.map((section) => (
            <a key={section.href} href={section.href} className={LINK}>
              {section.label}
            </a>
          ))}
        </nav>
        <div className="intro-late flex items-center gap-5">
          <Link href="/demo" className={cn(LINK, 'inline-flex min-h-11 items-center md:min-h-0')}>
            {demo}
          </Link>
          <PrimaryCta size="md" compact />
        </div>
      </div>
    </header>
  );
}
