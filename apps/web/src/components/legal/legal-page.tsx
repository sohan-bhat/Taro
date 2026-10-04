import * as React from 'react';
import { SiteHeader } from '@/components/site-header';
import { Footer } from '@/components/landing/footer';

const C = 'mx-auto w-full max-w-page px-4 min-[400px]:px-5 md:px-10';

export const REPO_URL = 'https://github.com/sohan-bhat/Taro';

/** A plain reading page: title, date, a short intro, then sections. */
export function LegalPage({ title, updated, intro, children }: { title: string; updated: string; intro: React.ReactNode; children: React.ReactNode }) {
  return (
    <>
      <SiteHeader />
      <main id="main" className={`${C} pb-24 pt-12 md:pt-20`}>
        <article className="max-w-[42rem] md:ml-28">
          <h1 className="text-title font-750 text-ink">{title}</h1>
          <p className="mt-3 text-sm text-ash">Last updated {updated}</p>
          <p className="mt-6 text-lede text-ink-2">{intro}</p>
          {children}
        </article>
      </main>
      <Footer />
    </>
  );
}

export function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mt-10">
      <h2 className="text-h3 font-bold text-ink">{title}</h2>
      <div className="mt-3 space-y-3 text-body text-ink-2">{children}</div>
    </section>
  );
}

/** A short list whose items lead with a bold phrase. */
export function Points({ items }: { items: Array<[string, React.ReactNode]> }) {
  return (
    <ul role="list" className="list-disc space-y-2 pl-5 marker:text-ash">
      {items.map(([lead, rest]) => (
        <li key={lead}>
          <span className="font-semibold text-ink">{lead}</span> {rest}
        </li>
      ))}
    </ul>
  );
}

export const LINK = 'text-taro underline decoration-1 underline-offset-[3px] hover:text-taro-hover';
