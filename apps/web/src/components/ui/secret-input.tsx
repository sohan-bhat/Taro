'use client';

import * as React from 'react';
import { cn } from '@/lib/utils';
import { INPUT } from './input';

/** API key field: hidden by default, never autofilled or spellchecked, with a Show and Hide toggle. */
export const SecretInput = React.forwardRef<HTMLInputElement, Omit<React.InputHTMLAttributes<HTMLInputElement>, 'type' | 'size'>>(
  ({ className, ...props }, ref) => {
    const [visible, setVisible] = React.useState(false);
    return (
      <div className="relative">
        <input
          ref={ref}
          type={visible ? 'text' : 'password'}
          autoComplete="off"
          autoCorrect="off"
          autoCapitalize="off"
          spellCheck={false}
          data-1p-ignore
          data-lpignore="true"
          className={cn(INPUT, 'h-11 pl-3.5 pr-16 font-mono md:h-10', className)}
          {...props}
        />
        <button
          type="button"
          onClick={() => setVisible((v) => !v)}
          disabled={props.disabled}
          className="absolute right-1 top-1/2 inline-flex h-11 -translate-y-1/2 items-center rounded-control px-2.5 text-meta font-semibold text-taro hover:text-taro-hover disabled:opacity-45 md:h-8"
        >
          {visible ? 'Hide' : 'Show'}
        </button>
      </div>
    );
  }
);
SecretInput.displayName = 'SecretInput';
