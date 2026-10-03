'use client';

import { useEffect, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { Wordmark } from '@/components/brand';
import { api } from '@/lib/api';
import { setToken, takeLoginNonce } from '@/lib/session';

// Slack sends the browser here with a one-time code. It's only accepted if the
// nonce matches the one this tab stored when sign-in started.
export default function AuthCallback() {
  const router = useRouter();
  const started = useRef(false);

  useEffect(() => {
    // Effects run twice in development; the nonce and code are single use.
    if (started.current) return;
    started.current = true;

    const params = new URLSearchParams(window.location.search);
    // Drop the code from the address bar and history right away
    window.history.replaceState(null, '', '/auth/callback');

    const fail = (reason: string) => router.replace(`/signin?error=${encodeURIComponent(reason)}`);
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
        router.replace('/dashboard');
      })
      .catch(() => fail('expired'));
  }, [router]);

  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-4">
      <Wordmark />
      <p className="italic text-ink-2">Signing you in…</p>
    </main>
  );
}
