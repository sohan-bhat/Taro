import * as React from 'react';
import { Slot } from '@radix-ui/react-slot';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '@/lib/utils';

/**
 * Raised ("Duolingo-style") buttons: a solid darker bottom edge drawn with a
 * hard box-shadow. Pressing translates the button down over the edge so it
 * physically depresses. Quiet variants (ghost/link/destructive) stay flat
 * with a subtle press nudge.
 */
const buttonVariants = cva(
  'inline-flex select-none items-center justify-center gap-2 whitespace-nowrap rounded-xl text-sm font-semibold transition-all duration-100 ease-out focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-taro-500 focus-visible:ring-offset-2 focus-visible:ring-offset-fog-50 disabled:pointer-events-none disabled:opacity-50',
  {
    variants: {
      variant: {
        default:
          'bg-taro-600 text-white shadow-[0_4px_0_theme(colors.taro.800)] hover:bg-taro-500 hover:shadow-[0_4px_0_theme(colors.taro.700)] active:translate-y-[4px] active:shadow-[0_0_0_theme(colors.taro.800)]',
        secondary:
          'bg-taro-50 text-taro-700 border border-taro-200 shadow-[0_3px_0_theme(colors.taro.200)] hover:bg-taro-100 active:translate-y-[3px] active:shadow-[0_0_0_theme(colors.taro.200)]',
        outline:
          'border border-fog-300 bg-white text-fog-700 shadow-[0_3px_0_theme(colors.fog.300)] hover:bg-fog-50 active:translate-y-[3px] active:shadow-[0_0_0_theme(colors.fog.300)]',
        ghost:
          'bg-white text-fog-600 border border-fog-200 shadow-[0_3px_0_theme(colors.fog.200)] hover:bg-fog-50 hover:text-fog-800 active:translate-y-[3px] active:shadow-[0_0_0_theme(colors.fog.200)]',
        destructive:
          'bg-white text-red-600 border border-red-200 shadow-[0_3px_0_theme(colors.red.200)] hover:bg-red-50 active:translate-y-[3px] active:shadow-[0_0_0_theme(colors.red.200)]',
        link: 'text-taro-600 underline-offset-4 underline decoration-taro-300 hover:text-taro-700',
      },
      size: {
        default: 'h-10 px-4',
        sm: 'h-8 rounded-lg px-3 text-xs',
        lg: 'h-11 rounded-xl px-6',
      },
    },
    defaultVariants: {
      variant: 'default',
      size: 'default',
    },
  }
);

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean;
}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, asChild = false, ...props }, ref) => {
    const Comp = asChild ? Slot : 'button';
    return (
      <Comp className={cn(buttonVariants({ variant, size, className }))} ref={ref} {...props} />
    );
  }
);
Button.displayName = 'Button';

export { Button, buttonVariants };
