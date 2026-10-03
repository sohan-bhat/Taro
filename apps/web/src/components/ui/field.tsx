import * as React from 'react';
import { Label } from './label';

/**
 * A label above, a hint below, and an error in place of the hint. The control (the one child)
 * gets aria-describedby and aria-invalid. Forms use noValidate, so this is the only error text.
 */
export function Field({
  label,
  htmlFor,
  error,
  hint,
  className,
  children,
}: {
  label: React.ReactNode;
  htmlFor: string;
  error?: React.ReactNode;
  hint?: React.ReactNode;
  className?: string;
  children: React.ReactNode;
}) {
  const noteId = error ? `${htmlFor}-error` : hint ? `${htmlFor}-hint` : undefined;
  let control = children;
  if (React.isValidElement<{ 'aria-describedby'?: string; 'aria-invalid'?: React.AriaAttributes['aria-invalid'] }>(children)) {
    const own = children.props['aria-describedby'];
    control = React.cloneElement(children, {
      'aria-describedby': [own, noteId].filter(Boolean).join(' ') || undefined,
      'aria-invalid': error ? true : children.props['aria-invalid'],
    });
  }
  return (
    <div className={className}>
      <Label htmlFor={htmlFor}>{label}</Label>
      {control}
      {error ? (
        <p id={noteId} className="mt-1.5 text-meta text-beet">
          {error}
        </p>
      ) : hint ? (
        <p id={noteId} className="mt-1.5 text-meta text-ash">
          {hint}
        </p>
      ) : null}
    </div>
  );
}
