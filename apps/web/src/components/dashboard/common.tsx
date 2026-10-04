'use client';

// Small pieces every dashboard file shares: the session guard, error text, and hooks for the
// viewport and a ticking clock.

import * as React from 'react';
import { ApiError } from '@/lib/api';

/** The API's own sentence when there is one; `fallback` for anything else. */
export function errorText(error: unknown, fallback: string): string {
  return error instanceof ApiError && error.message ? error.message : fallback;
}

// Returns true when the error ended the session and was handled (the page is leaving for sign-in).
type ErrorHandler = (error: unknown) => boolean;

const ErrorContext = React.createContext<ErrorHandler>(() => false);

/** The dashboard provides this; outside it (the demo) nothing is a session error. */
export const SessionGuard = ErrorContext.Provider;

export function useSessionGuard(): ErrorHandler {
  return React.useContext(ErrorContext);
}

function subscribeMedia(query: string) {
  return (onChange: () => void) => {
    const list = window.matchMedia(query);
    list.addEventListener('change', onChange);
    return () => list.removeEventListener('change', onChange);
  };
}

/** True while the media query matches. False on the server and during hydration. */
export function useMediaQuery(query: string): boolean {
  const subscribe = React.useMemo(() => subscribeMedia(query), [query]);
  return React.useSyncExternalStore(
    subscribe,
    () => window.matchMedia(query).matches,
    () => false
  );
}

/** From 1100px the meetings view shows two panes; below it the detail is its own view. */
export const WIDE = '(min-width: 1100px)';

/** The current time, refreshed every `ms`, for phrases like "Asked to join 2 min ago". */
export function useNow(ms: number): number {
  const [now, setNow] = React.useState(() => Date.now());
  React.useEffect(() => {
    setNow(Date.now());
    const timer = window.setInterval(() => setNow(Date.now()), ms);
    return () => window.clearInterval(timer);
  }, [ms]);
  return now;
}

/** Shows its children only after `ms`, so fast loads never flash a loading line. */
export function Delayed({ ms = 400, children }: { ms?: number; children: React.ReactNode }) {
  const [shown, setShown] = React.useState(false);
  React.useEffect(() => {
    const timer = window.setTimeout(() => setShown(true), ms);
    return () => window.clearTimeout(timer);
  }, [ms]);
  return shown ? <>{children}</> : null;
}

/**
 * Runs `reset` each time a dialog opens, and only then, so a background refresh of the data
 * behind it never wipes what someone typed.
 */
export function useOnOpen(open: boolean, reset: () => void) {
  const was = React.useRef(false);
  const latest = React.useRef(reset);
  latest.current = reset;
  React.useEffect(() => {
    if (open && !was.current) latest.current();
    was.current = open;
  }, [open]);
}

/**
 * After a dialog that opened with the page (from the address) closes, focus has nowhere to
 * return to; this puts it on a heading instead of leaving it on the page body.
 */
export function focusIfLost(id: string) {
  // Dialogs stay on screen through their 120 ms fade, holding focus until they unmount.
  window.setTimeout(() => {
    const active = document.activeElement;
    if (!active || active === document.body) document.getElementById(id)?.focus({ preventScroll: true });
  }, 200);
}
