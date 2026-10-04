import * as React from 'react';
import { cn } from '@/lib/utils';

// The taro corm with a waveform cut into it. The bars are holes in one even-odd path, so the mark
// needs no ids or masks and stays transparent through the cuts on any ground. It never moves.
const CORM =
  'M16 8.42C21.63 8.81 28.93 16.49 28.93 25.96C28.93 34.66 22.91 41.06 16 41.06C9.09 41.06 3.07 34.66 3.07 25.96C3.07 16.49 10.37 8.81 16 8.42Z';

const MASTER = {
  stroke: 1.92,
  sprout: ['M16 8.94V1', 'M16 4.58L11.14 1.26', 'M16 4.58L20.86 1.26'],
  bars:
    'M6.98 22.95a1.09 1.09 0 0 1 2.18 0v3.96a1.09 1.09 0 0 1 -2.18 0Z M10.94 21.23a1.09 1.09 0 0 1 2.18 0v7.42a1.09 1.09 0 0 1 -2.18 0Z M14.91 19.95a1.09 1.09 0 0 1 2.18 0v9.98a1.09 1.09 0 0 1 -2.18 0Z M18.88 21.23a1.09 1.09 0 0 1 2.18 0v7.42a1.09 1.09 0 0 1 -2.18 0Z M22.85 22.95a1.09 1.09 0 0 1 2.18 0v3.96a1.09 1.09 0 0 1 -2.18 0Z',
};

// Below 24px tall the five bars blur together, so the small drawing has three wider ones and a bolder sprout.
const SMALL = {
  stroke: 2.8,
  sprout: ['M16 9V2', 'M16 5.2L11.4 2', 'M16 5.2L20.6 2'],
  bars: 'M8.9 22.7a1.7 1.7 0 0 1 3.4 0v4.6a1.7 1.7 0 0 1 -3.4 0Z M14.3 20.1a1.7 1.7 0 0 1 3.4 0v9.8a1.7 1.7 0 0 1 -3.4 0Z M19.7 22.7a1.7 1.7 0 0 1 3.4 0v4.6a1.7 1.7 0 0 1 -3.4 0Z',
};

/** Taro purple on light grounds, Poi on Taro. Decorative unless `label` is given. */
export function Mark({
  height = 24,
  tone = 'taro',
  label,
  className,
}: {
  height?: number;
  tone?: 'taro' | 'poi';
  label?: string;
  className?: string;
}) {
  const drawing = height < 24 ? SMALL : MASTER;
  return (
    <svg
      viewBox="0 0 32 42"
      width={Math.round((height * 32) / 42)}
      height={height}
      // SVGs keep their own color in contrast themes, so the mark takes the system text color there.
      className={cn('shrink-0 forced-colors:text-[color:CanvasText]', tone === 'poi' ? 'text-poi' : 'text-taro', className)}
      {...(label ? { role: 'img', 'aria-label': label } : { 'aria-hidden': true })}
    >
      <g fill="none" stroke="currentColor" strokeWidth={drawing.stroke} strokeLinecap="round">
        {drawing.sprout.map((d) => (
          <path key={d} d={d} />
        ))}
      </g>
      <path fill="currentColor" fillRule="evenodd" d={`${CORM} ${drawing.bars}`} />
    </svg>
  );
}

/** The mark and "taro" in the record face. nav: a 29px mark and a 23px word. app: 24px and 19px. */
export function Wordmark({
  size = 'nav',
  tone = 'taro',
  className,
}: {
  size?: 'nav' | 'app';
  tone?: 'taro' | 'poi';
  className?: string;
}) {
  const nav = size === 'nav';
  return (
    <span className={cn('inline-flex items-center', nav ? 'gap-[9px]' : 'gap-[7px]', className)}>
      <Mark height={nav ? 29 : 24} tone={tone} />
      <span
        className={cn(
          'font-extrabold tracking-[-0.035em]',
          nav ? 'text-[23px]' : 'text-[19px]',
          // After the size: tailwind-merge drops a line height that comes before a font size.
          'leading-none',
          tone === 'poi' ? 'text-white' : 'text-ink'
        )}
      >
        taro
      </span>
    </span>
  );
}

/** The four-color Slack logo. */
export function SlackMark(props: React.SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 122.8 122.8" aria-hidden="true" {...props}>
      <path d="M25.8 77.6c0 7.1-5.8 12.9-12.9 12.9S0 84.7 0 77.6s5.8-12.9 12.9-12.9h12.9v12.9zM32.3 77.6c0-7.1 5.8-12.9 12.9-12.9s12.9 5.8 12.9 12.9v32.3c0 7.1-5.8 12.9-12.9 12.9s-12.9-5.8-12.9-12.9V77.6z" fill="#E01E5A" />
      <path d="M45.2 25.8c-7.1 0-12.9-5.8-12.9-12.9S38.1 0 45.2 0s12.9 5.8 12.9 12.9v12.9H45.2zM45.2 32.3c7.1 0 12.9 5.8 12.9 12.9s-5.8 12.9-12.9 12.9H12.9C5.8 58.1 0 52.3 0 45.2s5.8-12.9 12.9-12.9h32.3z" fill="#36C5F0" />
      <path d="M97 45.2c0-7.1 5.8-12.9 12.9-12.9s12.9 5.8 12.9 12.9-5.8 12.9-12.9 12.9H97V45.2zM90.5 45.2c0 7.1-5.8 12.9-12.9 12.9s-12.9-5.8-12.9-12.9V12.9C64.7 5.8 70.5 0 77.6 0s12.9 5.8 12.9 12.9v32.3z" fill="#2EB67D" />
      <path d="M77.6 97c7.1 0 12.9 5.8 12.9 12.9s-5.8 12.9-12.9 12.9-12.9-5.8-12.9-12.9V97h12.9zM77.6 90.5c-7.1 0-12.9-5.8-12.9-12.9s5.8-12.9 12.9-12.9h32.3c7.1 0 12.9 5.8 12.9 12.9s-5.8 12.9-12.9 12.9H77.6z" fill="#ECB22E" />
    </svg>
  );
}

/** Google's "G" in its standard colors, as Google's sign-in button guidelines draw it. It always sits on white. */
export function GoogleMark(props: React.SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="10 10 20 20" aria-hidden="true" {...props}>
      <path d="M29.6 20.2273C29.6 19.5182 29.5364 18.8364 29.4182 18.1818H20V22.05H25.3818C25.15 23.3 24.4455 24.3591 23.3864 25.0682V27.5773H26.6182C28.5091 25.8364 29.6 23.2727 29.6 20.2273Z" fill="#4285F4" />
      <path d="M20 30C22.7 30 24.9636 29.1045 26.6181 27.5773L23.3863 25.0682C22.4909 25.6682 21.3454 26.0227 20 26.0227C17.3954 26.0227 15.1909 24.2636 14.4045 21.9H11.0636V24.4909C12.7091 27.7591 16.0909 30 20 30Z" fill="#34A853" />
      <path d="M14.4045 21.9C14.2045 21.3 14.0909 20.6591 14.0909 20C14.0909 19.3409 14.2045 18.7 14.4045 18.1V15.5091H11.0636C10.3864 16.8591 10 18.3864 10 20C10 21.6136 10.3864 23.1409 11.0636 24.4909L14.4045 21.9Z" fill="#FBBC04" />
      <path d="M20 13.9773C21.4681 13.9773 22.7863 14.4818 23.8227 15.4727L26.6909 12.6045C24.9591 10.9909 22.6954 10 20 10C16.0909 10 12.7091 12.2409 11.0636 15.5091L14.4045 18.1C15.1909 15.7364 17.3954 13.9773 20 13.9773Z" fill="#E94235" />
    </svg>
  );
}

/** The Octocat mark, in currentColor. */
export function GithubMark(props: React.SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 16 16" fill="currentColor" aria-hidden="true" {...props}>
      <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.01 8.01 0 0 0 16 8c0-4.42-3.58-8-8-8z" />
    </svg>
  );
}
