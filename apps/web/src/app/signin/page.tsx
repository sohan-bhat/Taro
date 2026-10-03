'use client';

import { Suspense, useEffect } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { Wordmark } from '@/components/brand';
import { SignInWithSlackButton } from '@/components/sign-in';
import { getToken } from '@/lib/session';

const ERRORS: Record<string, string> = {
  session: 'Your session ended. Sign in again to pick up where you left off.',
  expired: 'That sign-in took too long to finish. Start it again below.',
  denied: 'Slack sign-in was cancelled.',
  slack_failed: "Slack couldn't confirm who you are. Try again.",
  missing_code: "Slack didn't send Taro what it needed. Try again.",
  mismatch: 'That sign-in was started in a different tab or browser. Start it again here.',
  start_from_taro: 'Start signing in from this page.',
  slack_guest: "Slack guests can't sign in to a workspace's Taro. Sign in with a workspace where you're a full member.",
  slack_deactivated: "That Slack account is deactivated, so it can't sign in.",
  removed: 'An owner removed you from this Taro workspace. Ask them to restore you.',
};

function SignInCard() {
  const router = useRouter();
  const params = useSearchParams();
  const error = params.get('error');

  useEffect(() => {
    if (!error && getToken()) router.replace('/dashboard');
  }, [error, router]);

  return (
    <div className="paper w-full max-w-[34rem] px-6 py-10 text-center sm:rounded-[2px] sm:px-12 sm:py-14 sm:shadow-page">
      <h1 className="font-title text-[clamp(2rem,1.7rem+1.4vw,2.6rem)] leading-tight">Sign in</h1>
      <p className="mt-2 italic text-ink-2">Your Taro workspace is your Slack workspace.</p>
      {error && (
        <p role="alert" className="mx-auto mt-6 max-w-[26rem] border-l-[3px] border-beet pl-3 text-left">
          {ERRORS[error] ?? 'Sign-in didn’t finish. Try again.'}
        </p>
      )}
      <SignInWithSlackButton className="mt-8 w-full" />
      <p className="mt-6 text-left text-foot text-ink-2">
        <span className="mb-2 block w-24 border-t border-ink" />
        <sup>∗</sup>Taro asks Slack only for your name, email, and photo.
      </p>
      <p className="mt-6 text-sm text-ink-2">
        New here?{' '}
        <Link href="/demo" className="tex-link">
          See the demo
        </Link>
        .
      </p>
    </div>
  );
}

export default function SignInPage() {
  return (
    <main className="flex min-h-screen flex-col">
      <header className="mx-auto flex w-full max-w-page items-center px-5 py-4 sm:px-2 sm:py-6">
        <Link href="/" className="rounded-sm">
          <Wordmark />
        </Link>
      </header>
      <div className="flex flex-1 items-start justify-center pb-16 sm:items-center sm:px-5">
        <Suspense fallback={null}>
          <SignInCard />
        </Suspense>
      </div>
    </main>
  );
}
