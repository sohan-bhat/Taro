import * as React from 'react';
import { cn } from '@/lib/utils';

// App panels: Paper, one Rule edge, no shadow. Add overflow-hidden when rows touch the edges.
const Card = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(({ className, ...props }, ref) => (
  <div ref={ref} className={cn('rounded-card border border-rule bg-paper', className)} {...props} />
));
Card.displayName = 'Card';

const CardHeader = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(({ className, ...props }, ref) => (
  <div
    ref={ref}
    className={cn('flex min-h-[52px] items-center justify-between gap-3 border-b border-rule px-5 py-3 md:px-6', className)}
    {...props}
  />
));
CardHeader.displayName = 'CardHeader';

type HeadingTag = 'h1' | 'h2' | 'h3' | 'h4' | 'p' | 'span';

const CardTitle = React.forwardRef<HTMLHeadingElement, React.HTMLAttributes<HTMLHeadingElement> & { as?: HeadingTag }>(
  ({ className, as: Tag = 'h2', ...props }, ref) => (
    <Tag ref={ref} className={cn('text-panel-title font-bold text-ink', className)} {...props} />
  )
);
CardTitle.displayName = 'CardTitle';

const CardDescription = React.forwardRef<HTMLParagraphElement, React.HTMLAttributes<HTMLParagraphElement>>(
  ({ className, ...props }, ref) => <p ref={ref} className={cn('text-sm text-ash', className)} {...props} />
);
CardDescription.displayName = 'CardDescription';

const CardContent = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(({ className, ...props }, ref) => (
  <div ref={ref} className={cn('px-5 py-5 md:px-6', className)} {...props} />
));
CardContent.displayName = 'CardContent';

const CardFooter = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(({ className, ...props }, ref) => (
  <div ref={ref} className={cn('flex items-center gap-3 border-t border-rule-soft px-5 py-3 md:px-6', className)} {...props} />
));
CardFooter.displayName = 'CardFooter';

export { Card, CardHeader, CardTitle, CardDescription, CardContent, CardFooter };
