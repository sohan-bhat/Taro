import * as React from 'react';
import { cn } from '@/lib/utils';

const Input = React.forwardRef<HTMLInputElement, React.InputHTMLAttributes<HTMLInputElement>>(
  ({ className, type, ...props }, ref) => {
    return (
      <input
        type={type}
        className={cn(
          'flex h-10 w-full rounded-xl border border-fog-300 bg-white px-3.5 py-2 text-sm text-fog-900 shadow-sm transition-colors placeholder:text-fog-400 hover:border-fog-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-taro-500 focus-visible:border-transparent disabled:cursor-not-allowed disabled:opacity-50 aria-[invalid=true]:border-red-300 aria-[invalid=true]:focus-visible:ring-red-400',
          className
        )}
        ref={ref}
        {...props}
      />
    );
  }
);
Input.displayName = 'Input';

export { Input };
