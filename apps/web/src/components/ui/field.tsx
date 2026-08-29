import * as React from 'react';
import { Label } from './label';
import { cn } from '@/lib/utils';

/** Forms use noValidate and this component's error text instead of native browser validation bubbles. */
export function Field({
  label,
  htmlFor,
  error,
  hint,
  className,
  children,
}: {
  label: string;
  htmlFor: string;
  error?: string;
  hint?: string;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <div className={cn('space-y-0', className)}>
      <Label htmlFor={htmlFor}>{label}</Label>
      {children}
      {error ? (
        <p className="text-xs text-red-600 mt-1.5">{error}</p>
      ) : hint ? (
        <p className="text-xs text-fog-400 mt-1.5">{hint}</p>
      ) : null}
    </div>
  );
}
