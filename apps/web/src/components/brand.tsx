/**
 * Brand primitives shared by the landing page and dashboard.
 * The mark is a taro corm (the vegetable Taro is named for) whose flesh is a
 * waveform: the product listens. Bars animate only when `live` is true, so
 * "listening" is never faked (see globals.css).
 */
import { cn } from '@/lib/utils';

export function WaveMark({ live = false, className = 'w-6 h-8' }: { live?: boolean; className?: string }) {
  return (
    <svg
      viewBox="0 0 32 42"
      fill="none"
      aria-hidden
      className={cn('text-taro-600', live && 'wave-live', className)}
    >
      {/* Leaf stems */}
      <g stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
        <path d="M16 7.5V3" />
        <path d="M15.5 6.5L11.5 3.5" />
        <path d="M16.5 6.5L20.5 3.5" />
      </g>
      {/* Corm outline: round shoulders, tapering to a point */}
      <path
        d="M16 9C9.5 9 5.5 15 5.5 21C5.5 28.5 10.5 35 16 39C21.5 35 26.5 28.5 26.5 21C26.5 15 22.5 9 16 9Z"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinejoin="round"
      />
      {/* Waveform flesh */}
      <g fill="currentColor">
        <rect className="wave-bar" x="9.5" y="18.5" width="2" height="8" rx="1" />
        <rect className="wave-bar" x="12.25" y="16.5" width="2" height="12" rx="1" />
        <rect className="wave-bar" x="15" y="14.5" width="2" height="16" rx="1" />
        <rect className="wave-bar" x="17.75" y="17.5" width="2" height="10" rx="1" />
        <rect className="wave-bar" x="20.5" y="19.5" width="2" height="6" rx="1" />
      </g>
    </svg>
  );
}

export function Wordmark({ live = false }: { live?: boolean }) {
  return (
    <span className="inline-flex items-center gap-2">
      <WaveMark live className="w-[22px] h-[29px]" />
      <span className="font-display font-bold text-xl tracking-tight text-fog-900">taro</span>
    </span>
  );
}

export function SlackIcon({ className = 'w-5 h-5' }: { className?: string }) {
  return (
    <svg viewBox="0 0 122.8 122.8" className={className} aria-hidden>
      <path d="M25.8 77.6c0 7.1-5.8 12.9-12.9 12.9S0 84.7 0 77.6s5.8-12.9 12.9-12.9h12.9v12.9zM32.3 77.6c0-7.1 5.8-12.9 12.9-12.9s12.9 5.8 12.9 12.9v32.3c0 7.1-5.8 12.9-12.9 12.9s-12.9-5.8-12.9-12.9V77.6z" fill="#E01E5A"/>
      <path d="M45.2 25.8c-7.1 0-12.9-5.8-12.9-12.9S38.1 0 45.2 0s12.9 5.8 12.9 12.9v12.9H45.2zM45.2 32.3c7.1 0 12.9 5.8 12.9 12.9s-5.8 12.9-12.9 12.9H12.9C5.8 58.1 0 52.3 0 45.2s5.8-12.9 12.9-12.9h32.3z" fill="#36C5F0"/>
      <path d="M97 45.2c0-7.1 5.8-12.9 12.9-12.9s12.9 5.8 12.9 12.9-5.8 12.9-12.9 12.9H97V45.2zM90.5 45.2c0 7.1-5.8 12.9-12.9 12.9s-12.9-5.8-12.9-12.9V12.9C64.7 5.8 70.5 0 77.6 0s12.9 5.8 12.9 12.9v32.3z" fill="#2EB67D"/>
      <path d="M77.6 97c7.1 0 12.9 5.8 12.9 12.9s-5.8 12.9-12.9 12.9-12.9-5.8-12.9-12.9V97h12.9zM77.6 90.5c-7.1 0-12.9-5.8-12.9-12.9s5.8-12.9 12.9-12.9h32.3c7.1 0 12.9 5.8 12.9 12.9s-5.8 12.9-12.9 12.9H77.6z" fill="#ECB22E"/>
    </svg>
  );
}

export function GithubIcon({ className = 'w-5 h-5' }: { className?: string }) {
  return (
    <svg viewBox="0 0 16 16" className={className} fill="currentColor" aria-hidden>
      <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.01 8.01 0 0 0 16 8c0-4.42-3.58-8-8-8z"/>
    </svg>
  );
}

export function CalendarIcon({ className = 'w-5 h-5' }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden>
      <rect x="3" y="5" width="18" height="16" rx="2" />
      <path d="M3 10h18M8 3v4M16 3v4" strokeLinecap="round" />
    </svg>
  );
}
