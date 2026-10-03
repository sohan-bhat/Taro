'use client';

import { useEffect, useRef, useState } from 'react';
import { dismissToast, subscribeToasts, type ToastItem } from './toast-store';
import { cn } from '@/lib/utils';

const DISMISS_MS = 4000;

function Toast({ toast }: { toast: ToastItem }) {
  const isError = toast.variant === 'error';
  const [hovered, setHovered] = useState(false);
  const [focused, setFocused] = useState(false);
  const remaining = useRef(DISMISS_MS);

  // The 4 seconds only count down while nobody is hovering or focused on the toast.
  useEffect(() => {
    if (isError || hovered || focused || toast.leaving) return;
    const started = Date.now();
    const timer = window.setTimeout(() => dismissToast(toast.id), remaining.current);
    return () => {
      window.clearTimeout(timer);
      remaining.current = Math.max(800, remaining.current - (Date.now() - started));
    };
  }, [isError, hovered, focused, toast.leaving, toast.id]);

  return (
    <div
      data-toast=""
      role={isError ? 'alert' : 'status'}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      onFocus={() => setFocused(true)}
      onBlur={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setFocused(false);
      }}
      className={cn(
        'pointer-events-auto flex w-full max-w-[360px] items-start gap-3 rounded-menu',
        isError
          ? 'border border-rule bg-paper py-3 pl-[19px] pr-4 text-ink shadow-[inset_4px_0_0_theme(colors.beet.DEFAULT),0_12px_32px_-12px_rgba(29,23,36,0.28)]'
          : 'on-ink bg-ink px-4 py-3 text-poi shadow-menu',
        toast.leaving ? 'animate-fade-out' : 'motion-safe:animate-toast-in motion-reduce:animate-fade-in'
      )}
    >
      <p className="flex-1 text-sm font-medium leading-snug">{toast.message}</p>
      <button
        type="button"
        onClick={() => dismissToast(toast.id)}
        className={cn(
          '-my-1 inline-flex min-h-11 shrink-0 items-center rounded-sm text-meta font-semibold underline underline-offset-[3px] sm:min-h-0',
          isError ? 'text-taro hover:text-taro-hover' : 'text-taro-200 hover:text-white'
        )}
      >
        Dismiss
      </button>
    </div>
  );
}

export function Toaster() {
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  useEffect(() => subscribeToasts(setToasts), []);

  return (
    <div
      aria-live="polite"
      className="pointer-events-none fixed inset-x-4 bottom-[calc(16px+env(safe-area-inset-bottom))] z-[60] flex flex-col items-center gap-2 sm:inset-x-auto sm:bottom-6 sm:right-6 sm:items-end"
    >
      {toasts.map((t) => (
        <Toast key={t.id} toast={t} />
      ))}
    </div>
  );
}
