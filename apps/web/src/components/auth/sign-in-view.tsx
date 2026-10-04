'use client';

import { Suspense, useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import type { SignInProvider } from '@taro/shared';
import { Alert } from '@/components/ui/alert';
import { Delayed } from '@/components/dashboard/common';
import { PROVIDER_NAMES, SIGN_IN_PROVIDERS, SignInButtons } from '@/components/sign-in';
import { api } from '@/lib/api';
import { getToken, safeNextPath } from '@/lib/session';
import { AUTH_BODY, AUTH_TITLE, AuthSplit, LINK } from './auth-split';

// What a Google or Microsoft sign-in that didn't finish comes back with.
function providerErrors(provider: 'google' | 'microsoft'): Record<string, string> {
  const name = PROVIDER_NAMES[provider];
  return {
    [`${provider}_denied`]: `${name} sign-in was canceled. Start again when you're ready.`,
    [`${provider}_failed`]: `${name} couldn't confirm who you are. Try again.`,
    [`${provider}_error`]: `${name} couldn't finish signing you in. Try again, or ask whoever runs this Taro server to check its ${name} sign-in setup.`,
    [`${provider}_unavailable`]: `Sign in with ${name} isn't set up on this Taro server. Choose another way below.`,
  };
}

// Reasons the callback (or a signed-out page) sends people back here with ?error=.
const ERRORS: Record<string, string> = {
  session: 'Your session ended. Sign in again to pick up where you left off.',
  expired: 'That sign-in took too long to finish. Start it again below.',
  denied: "Slack sign-in was canceled. Start again when you're ready.",
  slack_failed: "Slack couldn't confirm who you are. Try again.",
  slack_unavailable: "Sign in with Slack isn't set up on this Taro server. Choose another way below.",
  missing_code: "Slack didn't send Taro what it needed. Try again.",
  mismatch: 'That sign-in started in a different tab or browser. Start it again here.',
  start_from_taro: 'Start signing in from this page.',
  slack_guest: "Slack guests can't sign in to a workspace's Taro. Sign in with a workspace where you're a full member.",
  slack_deactivated: "That Slack account is deactivated, so it can't sign in.",
  removed: 'An owner removed you from this Taro workspace. Ask them to restore you.',
  ...providerErrors('google'),
  ...providerErrors('microsoft'),
  unverified_email: "That account's email address isn't verified yet, so it can't sign in. Verify it first, or use another account.",
  microsoft_admin_consent:
    'Your organization needs an admin to approve Taro before you can sign in with Microsoft. Ask your IT admin, then try again.',
  use_google: 'That Slack workspace is connected to a Taro workspace where people sign in with Google. Sign in with Google instead.',
  use_microsoft:
    'That Slack workspace is connected to a Taro workspace where people sign in with Microsoft. Sign in with Microsoft instead.',
};
// Own keys only: the code comes from the address bar, so "constructor" must not match.
const errorMessage = (code: string) =>
  Object.prototype.hasOwnProperty.call(ERRORS, code) ? ERRORS[code] : "Signing in didn't finish. Try again.";

// Three buttons and the gaps between them, held while the server says which it offers.
const OPTIONS_HEIGHT = 'h-[168px]';

/** The sign-ins this server offers, in the page's order. Null until it says. */
function useSignInProviders(): readonly SignInProvider[] | null {
  const [providers, setProviders] = useState<readonly SignInProvider[] | null>(null);
  useEffect(() => {
    let cancelled = false;
    api
      .meta()
      .then((meta) => {
        const offered: Record<SignInProvider, boolean> = {
          google: !!meta.googleSignIn,
          microsoft: !!meta.microsoftSignIn,
          slack: !!meta.slackSignIn,
        };
        if (!cancelled) setProviders(SIGN_IN_PROVIDERS.filter((p) => offered[p]));
      })
      // When the server can't say, offer them all. One that isn't set up says so when it's chosen.
      .catch(() => {
        if (!cancelled) setProviders(SIGN_IN_PROVIDERS);
      });
    return () => {
      cancelled = true;
    };
  }, []);
  return providers;
}

export function SignInView() {
  const providers = useSignInProviders();
  return (
    <AuthSplit>
      <h1 className={AUTH_TITLE}>Sign in to Taro</h1>
      <p className={AUTH_BODY}>
        Use your work account. Colleagues who sign in with the same company account land in the same workspace.
      </p>
      {/* The page is static, so the address is read on the client. Until then the buttons carry no return path. */}
      <Suspense fallback={<Options providers={providers} />}>
        <FromAddress providers={providers} />
      </Suspense>
      <p className="mt-4 text-sm text-ash">Taro asks only for your name, email, and profile picture.</p>
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

function Options({ providers, next }: { providers: readonly SignInProvider[] | null; next?: string | null }) {
  if (!providers) {
    return (
      <div className={`mt-6 ${OPTIONS_HEIGHT}`}>
        <Delayed>
          <p className="pt-3 text-sm text-ash">Loading the ways to sign in</p>
        </Delayed>
      </div>
    );
  }
  if (providers.length === 0) {
    return (
      <Alert tone="error" className="mt-6">
        No way to sign in is set up on this Taro server yet.
      </Alert>
    );
  }
  return <SignInButtons providers={providers} next={next} className="mt-6" />;
}

/** The parts that depend on ?error= and ?next=: the error note, the return path, and the signed-in redirect. */
function FromAddress({ providers }: { providers: readonly SignInProvider[] | null }) {
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
      <Options providers={providers} next={next} />
    </>
  );
}
