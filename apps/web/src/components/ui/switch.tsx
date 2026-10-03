'use client';

import * as React from 'react';
import { cn } from '@/lib/utils';

export interface SwitchProps extends Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, 'role' | 'onChange'> {
  checked: boolean;
  onCheckedChange?: (checked: boolean) => void;
}

/** A 36 by 20 switch. The knob is the button's only child span, which globals.css repaints in contrast themes. */
export const Switch = React.forwardRef<HTMLButtonElement, SwitchProps>(
  ({ checked, onCheckedChange, onClick, className, ...props }, ref) => (
    <button
      ref={ref}
      type="button"
      role="switch"
      aria-checked={checked}
      onClick={(e) => {
        onClick?.(e);
        if (!e.defaultPrevented) onCheckedChange?.(!checked);
      }}
      className={cn(
        'relative h-5 w-9 shrink-0 rounded-full border-[1.5px] transition-colors duration-120 disabled:cursor-default',
        checked ? 'border-taro bg-taro' : 'border-field bg-poi',
        className
      )}
      {...props}
    >
      <span
        aria-hidden="true"
        className={cn(
          'absolute left-[1.5px] top-[1.5px] h-3.5 w-3.5 rounded-full transition-transform duration-120',
          checked ? 'translate-x-4 bg-white' : 'bg-ash'
        )}
      />
    </button>
  )
);
Switch.displayName = 'Switch';

/**
 * A label and description on the left, the switch on the right; the whole row toggles it.
 * Read-only rows (members, the demo) disable the switch and say "On" or "Off" beside it.
 */
export function SwitchRow({
  label,
  description,
  checked,
  onCheckedChange,
  disabled = false,
  readOnly = false,
  className,
}: {
  label: React.ReactNode;
  description?: React.ReactNode;
  checked: boolean;
  onCheckedChange?: (checked: boolean) => void;
  disabled?: boolean;
  readOnly?: boolean;
  className?: string;
}) {
  const id = React.useId();
  const inert = disabled || readOnly;
  return (
    <label className={cn('flex min-h-11 items-center justify-between gap-4', !inert && 'cursor-pointer', className)}>
      <span className="min-w-0">
        <span id={`${id}-label`} className="block text-ui font-semibold text-ink">
          {label}
        </span>
        {description ? (
          <span id={`${id}-description`} className="block text-meta text-ash">
            {description}
          </span>
        ) : null}
      </span>
      <span className="flex shrink-0 items-center gap-2.5">
        {readOnly ? (
          <span aria-hidden="true" className="text-meta text-ash">
            {checked ? 'On' : 'Off'}
          </span>
        ) : null}
        <Switch
          checked={checked}
          onCheckedChange={onCheckedChange}
          disabled={inert}
          aria-labelledby={`${id}-label`}
          aria-describedby={description ? `${id}-description` : undefined}
        />
      </span>
    </label>
  );
}
