'use client';

import * as React from 'react';
import { createPortal } from 'react-dom';
import { cn } from '@/lib/utils';

const EXIT_MS = 120;
const TABBABLE =
  'a[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), ' +
  'textarea:not([disabled]), [tabindex]:not([tabindex="-1"]), [contenteditable="true"]';
const FIELDS = 'input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled])';

const DialogContext = React.createContext<{
  titleId: string;
  setDescriptionId: (id: string | undefined) => void;
} | null>(null);

/**
 * A modal: a bottom sheet on phones, a centered panel from 640px. Focus moves to the first field
 * (or the panel), Tab stays inside, Escape and the overlay close it unless `busy`, and focus
 * returns to whatever opened it. Keep it mounted with `open` toggling so it can fade out.
 */
export function Dialog({
  open,
  onClose,
  labelledBy,
  describedBy,
  size = 'md',
  busy = false,
  className,
  children,
}: {
  open: boolean;
  onClose: () => void;
  // Defaults to the id DialogTitle renders with
  labelledBy?: string;
  // Defaults to the id DialogDescription renders with, when there is one
  describedBy?: string;
  size?: 'md' | 'lg';
  // While saving: the overlay and Escape don't close it
  busy?: boolean;
  className?: string;
  children: React.ReactNode;
}) {
  const [mounted, setMounted] = React.useState(false);
  const [present, setPresent] = React.useState(open);
  const [descriptionId, setDescriptionId] = React.useState<string>();
  const autoTitleId = React.useId();
  const titleId = labelledBy ?? autoTitleId;
  const panelRef = React.useRef<HTMLDivElement>(null);

  // Remember what had focus when the dialog opened, before anything inside can take it.
  const openerRef = React.useRef<HTMLElement | null>(null);
  const wasOpen = React.useRef(false);
  if (open && !wasOpen.current && typeof document !== 'undefined') {
    openerRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  }
  wasOpen.current = open;

  React.useEffect(() => setMounted(true), []);

  // Stay on screen through the exit fade.
  React.useEffect(() => {
    if (open) {
      setPresent(true);
      return;
    }
    const timer = window.setTimeout(() => setPresent(false), EXIT_MS);
    return () => window.clearTimeout(timer);
  }, [open]);

  React.useEffect(() => {
    if (!open || !mounted) return;
    const panel = panelRef.current;
    if (panel && !panel.contains(document.activeElement)) {
      (panel.querySelector<HTMLElement>(FIELDS) ?? panel).focus({ preventScroll: true });
    }
    const body = document.body;
    const prev = { overflow: body.style.overflow, paddingRight: body.style.paddingRight };
    const scrollbar = window.innerWidth - document.documentElement.clientWidth;
    body.style.overflow = 'hidden';
    if (scrollbar > 0) body.style.paddingRight = `${scrollbar}px`;
    return () => {
      body.style.overflow = prev.overflow;
      body.style.paddingRight = prev.paddingRight;
      const opener = openerRef.current;
      if (opener?.isConnected) opener.focus({ preventScroll: true });
    };
  }, [open, mounted]);

  const context = React.useMemo(() => ({ titleId, setDescriptionId }), [titleId]);

  if (!mounted || (!open && !present)) return null;
  const closing = !open;

  const onKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (e.key === 'Escape') {
      e.stopPropagation();
      if (!busy && !closing) onClose();
      return;
    }
    if (e.key !== 'Tab') return;
    const panel = panelRef.current;
    if (!panel) return;
    const items = Array.from(panel.querySelectorAll<HTMLElement>(TABBABLE)).filter((el) => el.getClientRects().length > 0);
    if (items.length === 0) {
      e.preventDefault();
      panel.focus();
      return;
    }
    const first = items[0];
    const last = items[items.length - 1];
    const active = document.activeElement;
    if (e.shiftKey && (active === first || active === panel || !panel.contains(active))) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && (active === last || !panel.contains(active))) {
      e.preventDefault();
      first.focus();
    }
  };

  return createPortal(
    <DialogContext.Provider value={context}>
      <div
        className={cn('fixed inset-0 z-50 flex items-end justify-center sm:items-center sm:p-4', closing && 'pointer-events-none')}
        onKeyDown={onKeyDown}
      >
        <div
          aria-hidden="true"
          className={cn('absolute inset-0 bg-ink/40', closing ? 'animate-fade-out' : 'animate-fade-in')}
          onClick={() => {
            if (!busy && !closing) onClose();
          }}
        />
        <div
          ref={panelRef}
          role="dialog"
          aria-modal="true"
          aria-labelledby={titleId}
          aria-describedby={describedBy ?? descriptionId}
          data-dialog-panel=""
          tabIndex={-1}
          className={cn(
            'relative max-h-[90dvh] w-full overflow-y-auto overscroll-contain rounded-t-dialog bg-paper pb-[env(safe-area-inset-bottom)] shadow-dialog focus:outline-none sm:rounded-dialog',
            size === 'lg' ? 'sm:max-w-[560px]' : 'sm:max-w-[480px]',
            closing ? 'animate-fade-out' : 'motion-safe:animate-sheet-in motion-reduce:animate-fade-in sm:motion-safe:animate-dialog-in',
            className
          )}
        >
          {children}
        </div>
      </div>
    </DialogContext.Provider>,
    document.body
  );
}

export function DialogHeader({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn('px-5 pt-6 sm:px-7 sm:pt-7', className)} {...props} />;
}

export function DialogTitle({ className, id, ...props }: React.HTMLAttributes<HTMLHeadingElement>) {
  const context = React.useContext(DialogContext);
  return <h2 id={id ?? context?.titleId} className={cn('text-dialog-title font-bold text-ink', className)} {...props} />;
}

export function DialogDescription({ className, id, ...props }: React.HTMLAttributes<HTMLParagraphElement>) {
  const setDescriptionId = React.useContext(DialogContext)?.setDescriptionId;
  const autoId = React.useId();
  const descriptionId = id ?? autoId;
  React.useEffect(() => {
    setDescriptionId?.(descriptionId);
    return () => setDescriptionId?.(undefined);
  }, [setDescriptionId, descriptionId]);
  return <p id={descriptionId} className={cn('mt-2 text-ui leading-[1.55] text-ink-2', className)} {...props} />;
}

export function DialogBody({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn('space-y-5 px-5 py-5 sm:px-7', className)} {...props} />;
}

// Phones stack the buttons full width with the primary on top; from 640px they sit in a row, primary last.
export function DialogFooter({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn('flex flex-col-reverse gap-2 px-5 pb-6 sm:flex-row sm:justify-end sm:px-7 sm:pb-7', className)} {...props} />;
}
