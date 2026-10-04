// One column system for every landing section. The first 112px of the container (an 88px speaker
// track and a 24px gap; 56px on phones) is the margin where speaker names and times live. Everything
// else starts on the line track after it, and every right column starts on the same 7/5 line.
//
// The speaker track itself, TRACK_LG, lives with TranscriptRow in components/exchange.tsx. It isn't
// re-exported here because the nav, a client component, imports this file, and the re-export would
// ship the wake phrase matcher to the browser.

/** The page container. Content is 1120px wide from a 1280px viewport. */
export const C = 'mx-auto w-full max-w-page px-4 min-[400px]:px-5 md:px-10';

/** A block on the line track (blocks outside the hero; the hero keeps its own 56px track on phones). */
export const LINE = 'md:ml-28';

/** Splits the line track 7 to 5 with a 48px gap, from 1100px. */
export const LINE_SPLIT = 'grid gap-y-8 wide:grid-cols-[minmax(0,7fr)_minmax(0,5fr)] wide:gap-x-12 wide:gap-y-0';

/** For rows that start at the container edge: the margin plus the same 7fr, so the second column lands on the 7/5 line. */
export const PAGE_SPLIT = 'grid wide:grid-cols-[calc(112px+(100%-160px)*7/12)_minmax(0,1fr)] wide:gap-x-12';

/** Top padding for every section after the proof. */
export const SECTION_PAD = 'pt-[88px] md:pt-[104px] wide:pt-[120px]';

export const H2 = 'max-w-[16em] text-balance text-h2 font-750';
export const SUB = 'mt-[18px] max-w-measure text-lede text-ink-2';
