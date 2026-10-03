import * as React from 'react';
import { cva } from 'class-variance-authority';
import { cn } from '@/lib/utils';

// States are words; color only reinforces the word. No pill, no dot, no icon, and no flex,
// because flex swallows the space in "Live 34:12".
const statusVariants = cva('whitespace-nowrap text-meta leading-[1.45]', {
  variants: {
    tone: {
      live: 'font-semibold text-ink',
      attention: 'font-semibold text-taro',
      failed: 'font-semibold text-beet',
      ended: 'font-medium text-ash',
      neutral: 'font-medium text-ink-2',
    },
  },
  defaultVariants: { tone: 'neutral' },
});

export type StatusTone = 'live' | 'attention' | 'failed' | 'ended' | 'neutral';

export interface StatusProps extends React.HTMLAttributes<HTMLSpanElement> {
  tone?: StatusTone;
}

export function Status({ tone = 'neutral', className, ...props }: StatusProps) {
  return <span className={cn(statusVariants({ tone }), className)} {...props} />;
}

export { statusVariants };
