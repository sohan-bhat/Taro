import Link from 'next/link';
import { Wordmark } from '@/components/brand';
import { cn } from '@/lib/utils';
import { FOOTER } from './content';
import { C, PAGE_SPLIT } from './grid';

const REPO_URL = process.env.NEXT_PUBLIC_REPO_URL;

// 44px tall on phones, so every link is an easy tap
const LINK = 'inline-flex min-h-11 items-center rounded-sm transition-colors duration-120 hover:text-ink md:min-h-0';

export function Footer() {
  return (
    <footer className="pb-14 pt-10 text-sm text-ash">
      <div className={C}>
        <div className={cn(PAGE_SPLIT, 'gap-y-5')}>
          <div>
            <Wordmark size="app" />
          </div>
          <div>
            <ul role="list" className="flex list-none flex-wrap gap-x-[22px] gap-y-2">
              {FOOTER.links.map((link) => (
                <li key={link.href}>
                  <Link href={link.href} className={LINK}>
                    {link.label}
                  </Link>
                </li>
              ))}
              {REPO_URL && (
                <li>
                  <a href={REPO_URL} className={LINK}>
                    {FOOTER.source}
                  </a>
                </li>
              )}
            </ul>
            <p className="mt-3">{FOOTER.credits}</p>
          </div>
        </div>
      </div>
    </footer>
  );
}
