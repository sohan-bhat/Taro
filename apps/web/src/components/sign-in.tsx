'use client';

import * as React from 'react';
import Link from 'next/link';
import type { SignInProvider } from '@taro/shared';
import { api } from '@/lib/api';
import { newLoginNonce, rememberLoginNext } from '@/lib/session';
import { Button, type ButtonProps } from '@/components/ui/button';
import { GoogleMark, SlackMark } from '@/components/brand';
import { cn } from '@/lib/utils';

/** The order the sign-in page offers them in. */
export const SIGN_IN_PROVIDERS: readonly SignInProvider[] = ['google', 'slack'];

export const PROVIDER_NAMES: Record<SignInProvider, string> = { google: 'Google', slack: 'Slack' };

/**
 * Each company's sign-in button as its guidelines ask: its own mark in its own colors, its wording
 * ("Sign in with Slack" is the only wording Slack allows, so both say "Sign in with"), its light
 * theme's stroke and text colors, and its spacing between mark and words. Both are one size, so
 * neither is shown more prominently than the other, and they share the site's type to read as one set.
 */
const LOOK: Record<SignInProvider, { Mark: (props: React.SVGProps<SVGSVGElement>) => React.ReactElement; className: string; mark: string }> = {
  google: { Mark: GoogleMark, className: 'gap-2.5 border-google-stroke text-google-text', mark: 'h-5 w-5' },
  slack: { Mark: SlackMark, className: 'gap-3 border-slack-button-stroke text-slack-button-text', mark: 'h-5 w-5' },
};

const BUTTON =
  'inline-flex h-12 w-full select-none items-center justify-center whitespace-nowrap rounded border bg-white px-3 text-ui font-semibold ' +
  'transition-shadow duration-120 ease-out hover:shadow-signin focus-visible:outline focus-visible:outline-2 ' +
  'focus-visible:outline-offset-2 focus-visible:outline-taro disabled:pointer-events-none disabled:opacity-45 aria-busy:cursor-progress';

/** One button per provider. The nonce each stores is checked when the provider sends the browser back. */
export function SignInButtons({
  providers,
  next,
  className,
}: {
  providers: readonly SignInProvider[];
  // A page on this site to land on after signing in, instead of the dashboard
  next?: string | null;
  className?: string;
}) {
  const [leaving, setLeaving] = React.useState<SignInProvider | null>(null);

  // Coming back with the browser's Back button restores this page from cache; make the buttons usable again.
  React.useEffect(() => {
    const onShow = (e: PageTransitionEvent) => {
      if (e.persisted) setLeaving(null);
    };
    window.addEventListener('pageshow', onShow);
    return () => window.removeEventListener('pageshow', onShow);
  }, []);

  return (
    <div className={cn('grid gap-3', className)}>
      {providers.map((provider) => {
        const { Mark, className: look, mark } = LOOK[provider];
        const name = PROVIDER_NAMES[provider];
        return (
          <button
            key={provider}
            type="button"
            className={cn(BUTTON, look)}
            disabled={!!leaving}
            aria-busy={leaving === provider || undefined}
            onClick={() => {
              setLeaving(provider);
              rememberLoginNext(next);
              window.location.href = api.auth.startUrl(provider, newLoginNonce());
            }}
          >
            <Mark className={cn('shrink-0', mark)} />
            {leaving === provider ? `Opening ${name}` : `Sign in with ${name}`}
          </button>
        );
      })}
    </div>
  );
}

/**
 * "Get started" for visitors, "Open your dashboard" for people already signed in. Both are
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
  // primary on light grounds, inverse on Taro
  variant?: ButtonProps['variant'];
  // "Dashboard" below 640px, where the full label crowds a row
  compact?: boolean;
  className?: string;
}) {
  return (
    <>
      <Button asChild size={size} variant={variant} className={cn('session-out', className)}>
        <Link href="/signin">Get started</Link>
      </Button>
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
