import * as React from 'react';
import { cva } from 'class-variance-authority';
import { cn } from '@/lib/utils';

// The ruled note: a 3px left rule and a sentence. Leads with what happened, then what to do.
const alertVariants = cva('border-l-[3px] py-0.5 pl-3.5 text-sm leading-relaxed', {
  variants: {
    tone: {
      info: 'border-taro text-ink',
      error: 'border-beet text-ink',
      quiet: 'border-rule text-ink-2',
    },
  },
  defaultVariants: { tone: 'info' },
});

export type AlertTone = 'info' | 'error' | 'quiet';

// Old variant names, mapped until every call site uses `tone`.
const LEGACY_TONES = { default: 'info', destructive: 'error', success: 'quiet' } as const;

export interface AlertProps extends React.HTMLAttributes<HTMLDivElement> {
  tone?: AlertTone;
  /** @deprecated Use `tone`. */
  variant?: keyof typeof LEGACY_TONES;
}

export function Alert({ tone, variant, className, role, ...props }: AlertProps) {
  const t: AlertTone = tone ?? (variant ? LEGACY_TONES[variant] : 'info');
  return <div role={role ?? (t === 'error' ? 'alert' : 'status')} className={cn(alertVariants({ tone: t }), className)} {...props} />;
}

export { alertVariants };
