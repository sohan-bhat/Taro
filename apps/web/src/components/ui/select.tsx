import * as React from 'react';
import { cn } from '@/lib/utils';

/** Styled native select: keyboard and screen-reader behavior for free */
const Select = React.forwardRef<HTMLSelectElement, React.SelectHTMLAttributes<HTMLSelectElement>>(
  ({ className, children, ...props }, ref) => (
    <div className="relative">
      <select
        ref={ref}
        className={cn(
          // text-base on mobile (16px) prevents iOS zoom-on-focus; text-sm on desktop.
          'h-9 w-full appearance-none rounded-lg border border-fog-300 bg-white pl-3 pr-9 text-base sm:text-sm text-fog-900 shadow-sm transition-colors hover:border-fog-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-taro-500 focus-visible:border-transparent disabled:cursor-not-allowed disabled:opacity-50',
          className
        )}
        {...props}
      >
        {children}
      </select>
      <svg
        viewBox="0 0 20 20"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
        aria-hidden
        className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-fog-400"
      >
        <path d="M6 8l4 4 4-4" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    </div>
  )
);
Select.displayName = 'Select';

export { Select };
