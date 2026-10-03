import * as React from 'react';
import { cn } from '@/lib/utils';

// Shared by Input, Select, Textarea, and SecretInput. Phones get 16px text so iOS doesn't zoom on focus.
export const INPUT =
  'flex w-full rounded-control border border-field bg-paper text-base text-ink placeholder:text-ash ' +
  'transition-colors duration-120 md:text-ui focus-visible:border-taro focus-visible:outline-none ' +
  'focus-visible:ring-[3px] focus-visible:ring-taro/20 disabled:cursor-not-allowed disabled:opacity-45 ' +
  'aria-[invalid=true]:border-beet aria-[invalid=true]:focus-visible:ring-beet/20';

export const INPUT_SIZES = { md: 'h-11 px-3.5 md:h-10', lg: 'h-12 px-4' } as const;

export interface InputProps extends Omit<React.InputHTMLAttributes<HTMLInputElement>, 'size'> {
  size?: keyof typeof INPUT_SIZES;
}

const Input = React.forwardRef<HTMLInputElement, InputProps>(({ className, size = 'md', ...props }, ref) => (
  <input ref={ref} className={cn(INPUT, INPUT_SIZES[size], className)} {...props} />
));
Input.displayName = 'Input';

export { Input };
