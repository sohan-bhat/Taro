'use client';

import * as React from 'react';
import { cn } from '@/lib/utils';

/**
 * Accessible modal dialog: backdrop click and Escape cancel, focus moves to
 * the panel, and body scroll locks while open. Caller renders it conditionally
 * so it only mounts when open.
 */
export function Dialog({
  open,
  onClose,
  children,
  labelledBy,
}: {
  open: boolean;
  onClose: () => void;
  children: React.ReactNode;
  labelledBy?: string;
}) {
  const panelRef = React.useRef<HTMLDivElement>(null);

  // Must depend only on `open`, not `onClose` (a new function each render),
  // or it would re-focus the panel on every keystroke and steal focus from
  // inputs inside the dialog.
  React.useEffect(() => {
    if (!open) return;
    panelRef.current?.focus();
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = prevOverflow;
    };
  }, [open]);

  // Escape-to-close listener, rebound when onClose changes (no focus effects).
  React.useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby={labelledBy}
    >
      <button
        aria-label="Close"
        tabIndex={-1}
        onClick={onClose}
        className="absolute inset-0 bg-fog-900/40 backdrop-blur-sm cursor-default"
      />
      <div
        ref={panelRef}
        tabIndex={-1}
        className="relative w-full max-w-md bg-white border border-fog-200 rounded-2xl shadow-[0_8px_40px_-8px_rgba(28,25,35,0.25)] focus:outline-none animate-[dialog-in_120ms_ease-out]"
      >
        {children}
      </div>
      <style>{`@keyframes dialog-in { from { opacity: 0; transform: translateY(8px) scale(0.98) } to { opacity: 1; transform: none } }`}</style>
    </div>
  );
}

export function DialogHeader({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn('p-6 pb-0', className)} {...props} />;
}

export function DialogBody({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn('p-6 space-y-4', className)} {...props} />;
}

export function DialogFooter({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn('flex items-center justify-end gap-2 p-6 pt-0', className)} {...props} />;
}
