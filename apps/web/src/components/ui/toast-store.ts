'use client';

export type ToastVariant = 'success' | 'error';
export interface ToastItem {
  id: number;
  message: string;
  variant: ToastVariant;
  leaving: boolean;
}

const DISMISS_MS = 4000;
const EXIT_MS = 130; // must match the CSS exit animation duration

let toasts: ToastItem[] = [];
const listeners = new Set<(t: ToastItem[]) => void>();

function emit() {
  const snapshot = [...toasts];
  listeners.forEach((l) => l(snapshot));
}

export function subscribeToasts(fn: (t: ToastItem[]) => void): () => void {
  listeners.add(fn);
  fn([...toasts]);
  return () => listeners.delete(fn);
}

export function dismissToast(id: number) {
  toasts = toasts.map((t) => (t.id === id ? { ...t, leaving: true } : t));
  emit();
  setTimeout(() => {
    toasts = toasts.filter((t) => t.id !== id);
    emit();
  }, EXIT_MS);
}

export function showToast(message: string, variant: ToastVariant = 'success') {
  const id = Date.now() + Math.random();
  toasts = [...toasts, { id, message, variant, leaving: false }];
  emit();
  setTimeout(() => dismissToast(id), DISMISS_MS);
}
