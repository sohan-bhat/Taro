import { HeardText } from '@/components/exchange';
import { cn } from '@/lib/utils';
import { PROOF } from './content';
import { C, LINE, LINE_SPLIT } from './grid';
import { GithubIssueCard, GithubMarkdown } from './mocks/github';

const MARK = /\[([^\]]+)\]\{(\w+)\}/;

/**
 * Renders "[words]{pair}" as a provenance mark; the two halves of a pair light up together (globals.css).
 * Only the issue side takes focus and says who said it, so each pair is one stop for keyboards and taps.
 */
function Provenance({ text, side }: { text: string; side: 'quote' | 'issue' }) {
  // split keeps both groups: plain text, the marked words, their pair, plain text, and so on
  const parts = text.split(MARK);
  return (
    <>
      {parts.map((part, i) => {
        if (i % 3 === 0) return side === 'quote' ? <HeardText key={i} text={part} /> : part;
        if (i % 3 === 2) return null;
        const pair = parts[i + 1];
        return side === 'issue' ? (
          <span key={i} className="prov" data-pair={pair} tabIndex={0}>
            {part}
            <span className="sr-only">{` (${PROOF.pairs[pair]} said this)`}</span>
          </span>
        ) : (
          <span key={i} className="prov" data-pair={pair}>
            {part}
          </span>
        );
      })}
    </>
  );
}

export function Proof() {
  const { issue } = PROOF;
  return (
    <section id="heard" aria-labelledby="heard-title" className="pt-[88px] md:pt-[104px] wide:pt-12">
      <div className={C}>
        {/* The aside comes first in reading order; from 1100px the issue moves under the hero on the line track. */}
        <div className={cn('proof', LINE, LINE_SPLIT, 'wide:items-start')}>
          <div className="wide:col-start-2 wide:row-start-1">
            <h2 id="heard-title" className="text-balance text-h2-aside font-750">
              {PROOF.title}
            </h2>
            <p className="mt-3.5 text-body text-ink-2">{PROOF.sub}</p>
            <ol role="list" className="mt-[26px] grid list-none gap-[22px]">
              {PROOF.quotes.map((quote) => (
                <li key={quote.label}>
                  <p className="mb-1 text-meta font-semibold text-ash">{quote.label}</p>
                  <p className={cn('said text-said-lg', quote.asked ? 'text-ink' : 'text-ink-2')}>
                    <Provenance text={quote.said} side="quote" />
                  </p>
                  {quote.note && <p className="mt-1 text-sm text-ash">{quote.note}</p>}
                </li>
              ))}
            </ol>
            <p className="mt-[22px] text-sm text-ash">{PROOF.key}</p>
          </div>
          <div className="wide:col-start-1 wide:row-start-1">
            <GithubIssueCard repo={issue.repo} number={issue.number} title={issue.title} caption={issue.caption}>
              <GithubMarkdown source={issue.body} inline={(text) => <Provenance text={text} side="issue" />} />
            </GithubIssueCard>
          </div>
        </div>
      </div>
    </section>
  );
}
