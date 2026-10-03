'use client';

import * as React from 'react';
import { cn } from '@/lib/utils';

/** Up to two initials: "Olivia Owens" is "OO", "Priya" is "P". */
export function initials(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return '';
  const first = Array.from(words[0])[0] ?? '';
  const last = words.length > 1 ? Array.from(words[words.length - 1])[0] ?? '' : '';
  return (first + last).toUpperCase();
}

/** A 28px circle: the Slack photo, or initials on Corm when there is none or it fails to load. Decorative. */
export function Avatar({ name, src, className }: { name: string; src?: string; className?: string }) {
  const [failed, setFailed] = React.useState(false);
  React.useEffect(() => setFailed(false), [src]);

  if (src && !failed) {
    return (
      // Slack photos come from many hosts, so next/image would need every one allowlisted.
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={src}
        alt=""
        referrerPolicy="no-referrer"
        onError={() => setFailed(true)}
        className={cn('h-7 w-7 shrink-0 rounded-full object-cover', className)}
      />
    );
  }
  return (
    <span
      aria-hidden="true"
      className={cn('grid h-7 w-7 shrink-0 place-items-center rounded-full bg-corm text-[11px] font-bold text-taro', className)}
    >
      {initials(name)}
    </span>
  );
}
