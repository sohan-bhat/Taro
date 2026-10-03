'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { api } from '@/lib/api';
import { newLoginNonce } from '@/lib/session';
import { Button, type ButtonProps } from '@/components/ui/button';
import { SlackMark } from '@/components/brand';
import { cn } from '@/lib/utils';

/** Starts Sign in with Slack. The nonce it stores is checked when Slack sends the browser back. */
export function SignInWithSlackButton({
  label = 'Sign in with Slack',
  size = 'lg',
  variant = 'primary',
  compact = false,
  className,
}: {
  label?: string;
  size?: ButtonProps['size'];
  // primary on light grounds, inverse on Taro
  variant?: ButtonProps['variant'];
  // "Sign in" below 640px, where the full label crowds the nav
  compact?: boolean;
  className?: string;
}) {
  const [leaving, setLeaving] = useState(false);

  // Coming back with the browser's Back button restores this page from cache; make the button usable again.
  useEffect(() => {
    const onShow = (e: PageTransitionEvent) => {
      if (e.persisted) setLeaving(false);
    };
    window.addEventListener('pageshow', onShow);
    return () => window.removeEventListener('pageshow', onShow);
  }, []);

  return (
    <Button
      size={size}
      variant={variant}
      className={className}
      pending={leaving}
      onClick={() => {
        setLeaving(true);
        window.location.href = api.auth.slackStartUrl(newLoginNonce());
      }}
    >
      <span className="grid h-5 w-5 shrink-0 place-items-center rounded-[5px] bg-white">
        <SlackMark className="h-[13px] w-[13px]" />
      </span>
      {leaving ? (
        'Opening Slack'
      ) : compact ? (
        <>
          <span className="sm:hidden">Sign in</span>
          <span className="hidden sm:inline">{label}</span>
        </>
      ) : (
        label
      )}
    </Button>
  );
}

/**
 * "Sign in with Slack" for visitors, "Open your dashboard" for people already signed in. Both are
 * rendered; the head script in the root layout marks signed-in visitors before first paint and
 * globals.css hides the other one, so the button never swaps after hydration.
 */
export function PrimaryCta({
  size = 'lg',
  variant = 'primary',
  compact = false,
  className,
}: {
  size?: ButtonProps['size'];
  variant?: ButtonProps['variant'];
  compact?: boolean;
  className?: string;
}) {
  return (
    <>
      <SignInWithSlackButton size={size} variant={variant} compact={compact} className={cn('session-out', className)} />
      <Button asChild size={size} variant={variant} className={cn('session-in', className)}>
        <Link href="/dashboard">
          {compact ? (
            <>
              <span className="sm:hidden">Dashboard</span>
              <span className="hidden sm:inline">Open your dashboard</span>
            </>
          ) : (
            'Open your dashboard'
          )}
        </Link>
      </Button>
    </>
  );
}
