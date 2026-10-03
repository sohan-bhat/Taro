import * as React from 'react';
import { cn } from '@/lib/utils';
import { INPUT } from './input';

const SELECT_SIZES = { md: 'h-11 pl-3.5 pr-9 md:h-10', lg: 'h-12 pl-4 pr-10' } as const;

export interface SelectProps extends Omit<React.SelectHTMLAttributes<HTMLSelectElement>, 'size'> {
  size?: keyof typeof SELECT_SIZES;
  // Classes for the wrapper, which sets the width ("w-[118px]", "w-full max-w-[240px]").
  wrapperClassName?: string;
}

// A native select, so keyboard and screen reader behavior come for free. The chevron is the only glyph in the app chrome.
const Select = React.forwardRef<HTMLSelectElement, SelectProps>(
  ({ className, wrapperClassName, size = 'md', children, ...props }, ref) => (
    <div className={cn('relative', wrapperClassName)}>
      <select ref={ref} className={cn(INPUT, 'appearance-none', SELECT_SIZES[size], className)} {...props}>
        {children}
      </select>
      <svg
        viewBox="0 0 20 20"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
        aria-hidden="true"
        className="pointer-events-none absolute right-3 top-1/2 h-3 w-3 -translate-y-1/2 text-ash"
      >
        <path d="M5 8l5 5 5-5" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    </div>
  )
);
Select.displayName = 'Select';

export { Select };
