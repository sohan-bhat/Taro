import * as React from 'react';
import { cn } from '@/lib/utils';
import { INPUT } from './input';

// md:text-ui also sets a line height, so the relaxed leading is repeated at md.
const Textarea = React.forwardRef<HTMLTextAreaElement, React.TextareaHTMLAttributes<HTMLTextAreaElement>>(
  ({ className, ...props }, ref) => (
    <textarea
      ref={ref}
      className={cn(INPUT, 'min-h-24 resize-y px-3.5 py-2.5 leading-relaxed md:leading-relaxed', className)}
      {...props}
    />
  )
);
Textarea.displayName = 'Textarea';

export { Textarea };
