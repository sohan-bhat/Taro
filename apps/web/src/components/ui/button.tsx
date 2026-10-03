import * as React from 'react';
import { Slot } from '@radix-ui/react-slot';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '@/lib/utils';

const PRIMARY = 'border-transparent bg-taro text-white hover:bg-taro-hover active:translate-y-px active:bg-taro-press';
const SECONDARY = 'border-field bg-transparent text-ink hover:bg-poi active:bg-corm';
const MD = 'h-11 px-4 text-ui md:h-10';

// Filled variants keep a transparent 1.5px border so Windows contrast themes still draw an edge.
const buttonVariants = cva(
  'inline-flex select-none items-center justify-center gap-2 whitespace-nowrap rounded-control border-[1.5px] font-semibold ' +
    'transition-colors duration-120 ease-out focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 ' +
    'focus-visible:outline-taro disabled:pointer-events-none disabled:opacity-45 aria-busy:cursor-progress',
  {
    variants: {
      variant: {
        primary: PRIMARY,
        secondary: SECONDARY,
        ghost: 'border-transparent bg-transparent text-ink-2 hover:bg-poi hover:text-ink active:bg-corm',
        destructive: 'border-beet bg-transparent text-beet hover:bg-beet/[0.06] active:bg-beet/10',
        danger: 'border-transparent bg-beet text-white hover:bg-beet-hover active:translate-y-px',
        link: 'rounded-sm border-0 bg-transparent text-taro underline decoration-1 underline-offset-[3px] hover:text-taro-hover hover:decoration-2',
        inverse: 'border-transparent bg-poi text-ink hover:bg-white focus-visible:outline-poi',
        inverseOutline: 'border-poi/45 bg-transparent text-white hover:bg-white/10 focus-visible:outline-poi',
        // Migration aliases. Remove once every call site says primary or secondary.
        default: PRIMARY,
        outline: SECONDARY,
      },
      size: {
        sm: 'h-11 px-3.5 text-sm md:h-[34px] md:px-3',
        md: MD,
        lg: 'h-12 px-5 text-ui',
        // Migration alias for md
        default: MD,
      },
    },
    compoundVariants: [{ variant: 'link', className: 'h-auto min-h-11 px-0 md:h-auto md:min-h-0 md:px-0' }],
    defaultVariants: { variant: 'primary', size: 'md' },
  }
);

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean;
  // While an action runs: disabled and aria-busy. The caller swaps the label for a verb ("Saving").
  pending?: boolean;
}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, asChild = false, pending = false, type, disabled, ...props }, ref) => {
    const classes = cn(buttonVariants({ variant, size }), className);
    if (asChild) {
      return <Slot ref={ref} className={classes} aria-busy={pending || undefined} {...props} />;
    }
    return (
      <button
        ref={ref}
        type={type ?? 'button'}
        className={classes}
        disabled={disabled || pending}
        aria-busy={pending || undefined}
        {...props}
      />
    );
  }
);
Button.displayName = 'Button';

export { Button, buttonVariants };
