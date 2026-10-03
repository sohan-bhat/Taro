import { cn } from '@/lib/utils';

export function Separator({
  orientation = 'horizontal',
  soft = false,
  className,
}: {
  orientation?: 'horizontal' | 'vertical';
  // Rule Soft, for dividers inside white panels
  soft?: boolean;
  className?: string;
}) {
  return (
    <div
      role="separator"
      aria-orientation={orientation}
      className={cn(
        'shrink-0',
        soft ? 'bg-rule-soft' : 'bg-rule',
        orientation === 'horizontal' ? 'h-px w-full' : 'w-px self-stretch',
        className
      )}
    />
  );
}
