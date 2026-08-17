'use client';

import { useEffect, useState } from 'react';
import { subscribeToasts, dismissToast, type ToastItem } from './toast-store';
import { cn } from '@/lib/utils';

function Icon({ variant }: { variant: 'success' | 'error' }) {
  return variant === 'error' ? (
    <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="2.4" className="h-3.5 w-3.5">
      <path d="M6 6l8 8M14 6l-8 8" strokeLinecap="round" />
    </svg>
  ) : (
    <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="2.6" className="h-3.5 w-3.5">
      <path d="M4 10.5l4 4 8-9" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function ToastCard({ toast }: { toast: ToastItem }) {
  const isError = toast.variant === 'error';
  return (
    <div
      role="status"
      aria-live="polite"
      className={cn(
        'pointer-events-auto flex items-start gap-3 rounded-xl border py-3 pl-3 pr-2.5 shadow-[0_10px_30px_-10px_rgba(28,25,35,0.45)] w-[min(88vw,360px)]',
        toast.leaving ? 'animate-[toast-out_130ms_ease-in_forwards]' : 'animate-[toast-in_190ms_cubic-bezier(0.2,0.9,0.3,1.3)]',
        isError
          ? 'bg-red-950 border-red-800 text-red-50'
          : 'bg-taro-900 border-taro-700 text-fog-50'
      )}
    >
      <span
        className={cn(
          'mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full',
          isError ? 'bg-red-500/25 text-red-200' : 'bg-taro-400/25 text-taro-100'
        )}
      >
        <Icon variant={toast.variant} />
      </span>

      <p className="flex-1 pt-0.5 text-sm font-medium leading-snug">{toast.message}</p>

      {/* 3D close button, matching the app's raised buttons */}
      <button
        aria-label="Dismiss"
        onClick={() => dismissToast(toast.id)}
        className={cn(
          'shrink-0 grid h-6 w-6 place-items-center rounded-lg text-current transition-all duration-100',
          'bg-white/10 hover:bg-white/20 active:translate-y-[2px]',
          'shadow-[0_2px_0_rgba(0,0,0,0.35)] active:shadow-[0_0_0_rgba(0,0,0,0.35)]'
        )}
      >
        <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="2" className="h-3.5 w-3.5">
          <path d="M6 6l8 8M14 6l-8 8" strokeLinecap="round" />
        </svg>
      </button>
    </div>
  );
}

export function Toaster() {
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  useEffect(() => subscribeToasts(setToasts), []);

  return (
    <div className="fixed top-4 right-4 z-50 flex flex-col items-end gap-2 pointer-events-none">
      {toasts.map((t) => (
        <ToastCard key={t.id} toast={t} />
      ))}
    </div>
  );
}
