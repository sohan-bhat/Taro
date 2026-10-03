import * as React from 'react';
import { Status, statusVariants, type StatusTone } from './status';

// Old Badge variants, mapped onto Status tones. Delete this file once nothing imports it.
const TONES: Record<BadgeVariant, StatusTone> = {
  default: 'neutral',
  success: 'neutral',
  warning: 'attention',
  info: 'attention',
  destructive: 'failed',
  muted: 'ended',
  outline: 'ended',
};

type BadgeVariant = 'default' | 'success' | 'warning' | 'destructive' | 'info' | 'muted' | 'outline';

export interface BadgeProps extends React.HTMLAttributes<HTMLSpanElement> {
  variant?: BadgeVariant | null;
}

/** @deprecated Use `Status` from components/ui/status. */
export function Badge({ variant, ...props }: BadgeProps) {
  return <Status tone={TONES[variant ?? 'default']} {...props} />;
}

/** @deprecated Use `statusVariants`. */
export const badgeVariants = ({ variant }: { variant?: BadgeVariant | null } = {}) =>
  statusVariants({ tone: TONES[variant ?? 'default'] });
