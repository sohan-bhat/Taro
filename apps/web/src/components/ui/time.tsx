'use client';

import * as React from 'react';
import { formatClock, formatDay, formatElapsed } from '@/lib/format';

/**
 * A static time with proportional figures. `clock` is "2:06 PM"; `day` is "Today", "Yesterday",
 * "Sep 30", or "Sep 30, 2025", compared against `now` (the demo passes its capture time and zone,
 * so the prerendered page and the browser print the same text).
 */
export function Time({
  iso,
  format,
  timeZone,
  now,
  inSentence = false,
  className,
}: {
  iso: string;
  format: 'clock' | 'day';
  timeZone?: string;
  now?: string | number;
  // Mid-sentence: "Connected today", not "Connected Today". Dates keep their capitals.
  inSentence?: boolean;
  className?: string;
}) {
  let text = format === 'clock' ? formatClock(iso, { timeZone }) : formatDay(iso, { timeZone, now: now ?? Date.now() });
  if (inSentence && (text === 'Today' || text === 'Yesterday')) text = text.toLowerCase();
  return (
    <time dateTime={iso} className={className}>
      {text}
    </time>
  );
}

function useReducedMotion(): boolean {
  const [reduced, setReduced] = React.useState(false);
  React.useEffect(() => {
    const query = window.matchMedia('(prefers-reduced-motion: reduce)');
    const update = () => setReduced(query.matches);
    update();
    query.addEventListener('change', update);
    return () => query.removeEventListener('change', update);
  }, []);
  return reduced;
}

// "34 min" or "1 hr 4 min", for people who asked for less motion.
function minutesSince(ms: number): string {
  const minutes = Math.max(1, Math.floor(ms / 60_000));
  if (minutes < 60) return `${minutes} min`;
  const rest = minutes % 60;
  return rest ? `${Math.floor(minutes / 60)} hr ${rest} min` : `${Math.floor(minutes / 60)} hr`;
}

/**
 * Time since `since`: "34:12" or "1:04:12", ticking every second. Digits are tabular; the colons sit
 * between the digit spans so they keep their natural width. With reduced motion it reads "34 min" and
 * updates once a minute. The ticking text is hidden from screen readers, which hear "Live since 2:00 PM"
 * once; it is never a live region. `prefix` joins the hidden text, so a status can read "Live 34:12".
 */
export function LiveClock({
  since,
  prefix,
  timeZone,
  className,
}: {
  since: string;
  prefix?: string;
  timeZone?: string;
  className?: string;
}) {
  const reduced = useReducedMotion();
  const [now, setNow] = React.useState(() => Date.now());

  React.useEffect(() => {
    setNow(Date.now());
    const timer = window.setInterval(() => setNow(Date.now()), reduced ? 60_000 : 1000);
    return () => window.clearInterval(timer);
  }, [reduced]);

  const ms = Math.max(0, now - Date.parse(since));
  return (
    <span className={className}>
      <span aria-hidden="true">
        {prefix}
        {reduced
          ? minutesSince(ms)
          : formatElapsed(ms)
              .split(':')
              .map((group, i) => (
                <React.Fragment key={i}>
                  {i > 0 ? ':' : null}
                  <span className="tnum">{group}</span>
                </React.Fragment>
              ))}
      </span>
      <span className="sr-only">Live since {formatClock(since, { timeZone })}</span>
    </span>
  );
}
