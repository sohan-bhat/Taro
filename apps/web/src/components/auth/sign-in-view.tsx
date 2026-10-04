'use client';

import { Suspense, useEffect } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { Alert } from '@/components/ui/alert';
import { SignInWithSlackButton } from '@/components/sign-in';
import { getToken, safeNextPath } from '@/lib/session';
import { AUTH_BODY, AUTH_TITLE, AuthSplit, LINK } from './auth-split';

// Reasons the callback (or a signed-out page) sends people back here with ?error=.
const ERRORS: Record<string, string> = {
  session: 'Your session ended. Sign in again to pick up where you left off.',
  expired: 'That sign-in took too long to finish. Start it again below.',
  denied: "Slack sign-in was canceled. Start again when you're ready.",
  slack_failed: "Slack couldn't confirm who you are. Try again.",
  missing_code: "Slack didn't send Taro what it needed. Try again.",
  mismatch: 'That sign-in started in a different tab or browser. Start it again here.',
  start_from_taro: 'Start signing in from this page.',
  slack_guest: "Slack guests can't sign in to a workspace's Taro. Sign in with a workspace where you're a full member.",
  slack_deactivated: "That Slack account is deactivated, so it can't sign in.",
  removed: 'An owner removed you from this Taro workspace. Ask them to restore you.',
};
// Own keys only: the code comes from the address bar, so "constructor" must not match.
const errorMessage = (code: string) =>
  Object.prototype.hasOwnProperty.call(ERRORS, code) ? ERRORS[code] : "Signing in didn't finish. Try again.";

const BUTTON = 'mt-6 w-full';

export function SignInView() {
  return (
    <AuthSplit>
      <h1 className={AUTH_TITLE}>Sign in to Taro</h1>
      <p className={AUTH_BODY}>
        Use your Slack account. Your Taro workspace is your Slack workspace, so teammates who sign in land in the same
        place.
      </p>
      {/* The page is static, so the address is read on the client. Until then the button carries no return path. */}
      <Suspense fallback={<SignInWithSlackButton size="lg" className={BUTTON} />}>
        <FromAddress />
      </Suspense>
      <p className="mt-4 text-sm text-ash">Taro asks Slack only for your name, email, and profile picture.</p>
      <p className="mt-8 text-sm text-ink-2">
        New here?{' '}
        <Link href="/demo" className={LINK}>
          See the demo first
        </Link>
        .
      </p>
    </AuthSplit>
  );
}

/** The parts that depend on ?error= and ?next=: the error note, the return path, and the signed-in redirect. */
function FromAddress() {
  const router = useRouter();
  const params = useSearchParams();
  const error = params.get('error');
  const next = params.get('next');

  useEffect(() => {
    if (!error && getToken()) router.replace(safeNextPath(next) ?? '/dashboard');
  }, [error, next, router]);

  return (
    <>
      {error && (
        <Alert tone="error" className="mt-6">
          {errorMessage(error)}
        </Alert>
      )}
      <SignInWithSlackButton size="lg" next={next} className={BUTTON} />
    </>
  );
}
