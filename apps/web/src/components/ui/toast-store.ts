'use client';

export type ToastVariant = 'success' | 'error';
export interface ToastItem {
  id: number;
  message: string;
  variant: ToastVariant;
  leaving: boolean;
}

const EXIT_MS = 120; // matches animate-fade-out
const MAX_TOASTS = 4;

let toasts: ToastItem[] = [];
let nextId = 1;
const listeners = new Set<(t: ToastItem[]) => void>();

function emit() {
  const snapshot = [...toasts];
  listeners.forEach((l) => l(snapshot));
}

export function subscribeToasts(fn: (t: ToastItem[]) => void): () => void {
  listeners.add(fn);
  fn([...toasts]);
  return () => {
    listeners.delete(fn);
  };
}

export function dismissToast(id: number) {
  if (!toasts.some((t) => t.id === id && !t.leaving)) return;
  toasts = toasts.map((t) => (t.id === id ? { ...t, leaving: true } : t));
  emit();
  setTimeout(() => {
    toasts = toasts.filter((t) => t.id !== id);
    emit();
  }, EXIT_MS);
}

/** Success toasts leave after 4 seconds (the Toaster pauses that while hovered or focused). Errors stay until dismissed. */
export function showToast(message: string, variant: ToastVariant = 'success'): number {
  const same = toasts.find((t) => !t.leaving && t.message === message && t.variant === variant);
  if (same) return same.id;
  const id = nextId++;
  toasts = [...toasts, { id, message, variant, leaving: false }];
  const extra = toasts.filter((t) => !t.leaving).length - MAX_TOASTS;
  if (extra > 0) toasts.filter((t) => !t.leaving).slice(0, extra).forEach((t) => dismissToast(t.id));
  emit();
  return id;
}
