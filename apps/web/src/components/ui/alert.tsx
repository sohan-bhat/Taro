import * as React from 'react';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '@/lib/utils';

const alertVariants = cva('rounded-xl border px-3.5 py-2.5 text-sm leading-relaxed', {
  variants: {
    variant: {
      default: 'bg-taro-50 border-taro-200 text-taro-800',
      destructive: 'bg-red-50 border-red-200 text-red-700',
      success: 'bg-emerald-50 border-emerald-200 text-emerald-700',
    },
  },
  defaultVariants: { variant: 'default' },
});

export interface AlertProps
  extends React.HTMLAttributes<HTMLDivElement>,
    VariantProps<typeof alertVariants> {}

function Alert({ className, variant, ...props }: AlertProps) {
  return <div role="alert" className={cn(alertVariants({ variant }), className)} {...props} />;
}

export { Alert };
