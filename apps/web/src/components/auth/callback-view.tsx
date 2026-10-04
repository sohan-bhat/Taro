'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Alert } from '@/components/ui/alert';
import { api, ApiError } from '@/lib/api';
import { setToken, takeLoginNext, takeLoginNonce } from '@/lib/session';
import { AUTH_BODY, AUTH_TITLE, AuthSplit, LINK } from './auth-split';

const SLOW_MS = 10_000;

// The API sends the browser here with a one-time code once Google, Microsoft, or Slack has
// answered. It's only accepted if the nonce matches the one this tab stored when sign-in started.
export function CallbackView() {
  const router = useRouter();
  const started = useRef(false);
  const [slow, setSlow] = useState(false);
  // Where sign-in should land. Read once, and handed back to /signin if this attempt fails,
  // so starting over still returns to the page that asked for sign-in.
  const next = useRef<string | null>(null);

  useEffect(() => {
    // Effects run twice in development; the nonce and code are single use.
    if (started.current) return;
    started.current = true;

    const params = new URLSearchParams(window.location.search);
    // Drop the code from the address bar and history right away
    window.history.replaceState(null, '', '/auth/callback');
    next.current = takeLoginNext();

    const fail = (reason: string) => router.replace(signInPath(next.current, reason));
    const error = params.get('error');
    if (error) return fail(error);

    const code = params.get('code');
    const nonce = params.get('n');
    const expected = takeLoginNonce();
    if (!code || !nonce || !expected || nonce !== expected) return fail('mismatch');

    api.auth
      .exchange(code)
      .then(({ token }) => {
        setToken(token);
        router.replace(next.current ?? '/dashboard');
      })
      // Only a refused code means the sign-in expired; a dropped connection or a busy server is "didn't finish".
      .catch((error) => fail(error instanceof ApiError && (error.status === 400 || error.status === 401) ? 'expired' : 'unfinished'));
  }, [router]);

  useEffect(() => {
    const timer = window.setTimeout(() => setSlow(true), SLOW_MS);
    return () => window.clearTimeout(timer);
  }, []);

  return (
    <>
      {/* Grows to 80% over 4 seconds and holds; static at 40% with reduced motion. Light on the phone band, which is Taro. */}
      <div
        data-progress
        className="fixed inset-x-0 top-0 z-50 h-0.5 origin-left bg-taro-200 motion-safe:animate-progress motion-reduce:scale-x-[0.4] md:bg-taro"
      />
      <AuthSplit>
        <div aria-live="polite">
          <h1 className={AUTH_TITLE}>Signing you in</h1>
          <p className={AUTH_BODY}>Taro is finishing your sign-in now.</p>
        </div>
        {slow && (
          <Alert tone="info" className="mt-6">
            This is taking longer than usual.{' '}
            <Link href={signInPath(next.current)} className={LINK}>
              Start again
            </Link>
            .
          </Alert>
        )}
      </AuthSplit>
    </>
  );
}

function signInPath(next: string | null, error?: string) {
  const params = new URLSearchParams();
  if (error) params.set('error', error);
  if (next) params.set('next', next);
  const query = params.toString();
  return query ? `/signin?${query}` : '/signin';
}
