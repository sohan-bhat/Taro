'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { api, API_URL, ApiError, isSessionError } from '@/lib/api';
import { clearToken, getToken } from '@/lib/session';
import { AUTH_BODY, AUTH_TITLE, AuthSplit, LINK } from './auth-split';

// The Taro for Google Meet extension opens this page as /extension/connect?id=<extension id>&n=<nonce>.
// Once the person agrees, it creates a limited token and hands it straight to that extension.

const EXTENSION_ID = /^[a-p]{32}$/;
const NONCE = /^[A-Za-z0-9-]{16,64}$/;
// Extension builds this dashboard trusts, compiled in at build time.
const TRUSTED_IDS = (process.env.NEXT_PUBLIC_TARO_EXTENSION_IDS ?? '')
  .split(',')
  .map((id) => id.trim())
  .filter((id) => EXTENSION_ID.test(id));
// The extension answers from its own storage, so this only catches a worker that never replies.
const REPLY_TIMEOUT_MS = 10_000;

const INVALID = "This link isn't valid. Start again from the Taro button in Google Meet.";
const UNSUPPORTED = 'This page only works when you open it from the Taro button in Google Meet.';
const NO_ANSWER =
  "The Taro extension didn't answer. Check that it's turned on, then start again from the Taro button in Google Meet.";
const NOT_ACCEPTED = "The Taro extension didn't accept this connection. Start again from the Taro button in Google Meet.";

// Just the part of the chrome.runtime API that Chromium browsers give pages an installed extension trusts.
// In Firefox the extension's bridge script on this page provides the same call.
type Reply = { ok?: unknown; error?: unknown } | undefined;
type Runtime = {
  sendMessage: (extensionId: string, message: object, callback: (reply: Reply) => void) => void;
  lastError?: { message?: string };
};

type Who = { workspace: string; name: string };
type State =
  | { kind: 'checking' }
  | { kind: 'invalid' }
  | { kind: 'unsupported' }
  // Taro couldn't load the session; trying again is safe
  | { kind: 'unavailable'; message: string }
  // The extension refused the request or didn't answer; only a fresh start from Meet helps
  | { kind: 'refused'; who: Who; message: string }
  // `error`: the last attempt failed before a token reached the extension, so trying again is safe
  | { kind: 'ready'; who: Who; error?: string }
  | { kind: 'connecting'; who: Who }
  | { kind: 'connected'; who: Who };

export function ExtensionConnectView() {
  const router = useRouter();
  const [state, setState] = useState<State>({ kind: 'checking' });
  const [attempt, setAttempt] = useState(0);
  const request = useRef<{ id: string; nonce: string } | null>(null);
  // Set on the first click and cleared only when no token was created, so a token is never sent twice.
  const sending = useRef(false);
  // A busy button is disabled, and Chrome drops focus from a disabled button. Once a click settles,
  // focus goes back to the page's button, or to the heading when the outcome leaves no button.
  const refocus = useRef(false);
  const heading = useRef<HTMLHeadingElement>(null);
  const button = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    let cancelled = false;
    const params = new URLSearchParams(window.location.search);
    const id = params.get('id') ?? '';
    const nonce = params.get('n') ?? '';
    // Nothing is requested for a link this dashboard didn't expect.
    if (!EXTENSION_ID.test(id) || !TRUSTED_IDS.includes(id) || !NONCE.test(nonce)) {
      setState({ kind: 'invalid' });
      return;
    }
    const runtime = chromeRuntime();
    if (!runtime) {
      setState({ kind: 'unsupported' });
      return;
    }
    const here = window.location.pathname + window.location.search;
    if (!getToken()) {
      router.replace(`/signin?next=${encodeURIComponent(here)}`);
      return;
    }

    request.current = { id, nonce };
    (async () => {
      let who: Who;
      try {
        const { workspace, me } = await api.auth.session();
        who = { workspace: workspace.name, name: me.name };
      } catch (error) {
        if (cancelled) return;
        if (isSessionError(error)) {
          clearToken();
          router.replace(`/signin?error=session&next=${encodeURIComponent(here)}`);
        } else {
          setState({ kind: 'unavailable', message: loadError(error) });
        }
        return;
      }
      if (cancelled) return;
      // Ask the extension whether this browser really started this request, before offering to connect.
      const hello = verdict(await ask(runtime, id, { type: 'taro.hello', nonce }));
      if (cancelled) return;
      setState(hello.ok ? { kind: 'ready', who } : { kind: 'refused', who, message: hello.message });
    })();
    return () => {
      cancelled = true;
    };
  }, [router, attempt]);

  useEffect(() => {
    if (!refocus.current || state.kind === 'checking' || state.kind === 'connecting') return;
    refocus.current = false;
    (button.current ?? heading.current)?.focus();
  }, [state.kind]);

  async function connect() {
    const runtime = chromeRuntime();
    if (state.kind !== 'ready' || !request.current || !runtime || sending.current) return;
    sending.current = true;
    refocus.current = true;
    const { who } = state;
    const { id, nonce } = request.current;
    setState({ kind: 'connecting', who });

    // Check again right before creating a token: the tab may have sat open past the request's 15 minutes.
    const fresh = verdict(await ask(runtime, id, { type: 'taro.hello', nonce }));
    if (!fresh.ok) return setState({ kind: 'refused', who, message: fresh.message });

    let token: string;
    try {
      ({ token } = await api.extension.token(browserLabel(navigator.userAgent)));
    } catch (error) {
      if (isSessionError(error)) {
        clearToken();
        router.replace(`/signin?error=session&next=${encodeURIComponent(window.location.pathname + window.location.search)}`);
        return;
      }
      sending.current = false;
      return setState({ kind: 'ready', who, error: tokenError(error) });
    }

    const saved = verdict(
      await ask(runtime, id, { type: 'taro.connect', token, apiUrl: API_URL, nonce, workspace: who.workspace, user: who.name })
    );
    setState(saved.ok ? { kind: 'connected', who } : { kind: 'refused', who, message: saved.message });
  }

  if (state.kind === 'connected') {
    return (
      <AuthSplit>
        <h1 ref={heading} tabIndex={-1} className={AUTH_TITLE}>
          This browser is connected
        </h1>
        <p className={AUTH_BODY}>
          Go back to your Google Meet tab and click <span className="font-semibold text-ink">Invite Taro</span>.
        </p>
        <p className="mt-8 text-sm text-ink-2">
          You can disconnect this browser anytime on the{' '}
          <Link href="/dashboard?view=setup" className={LINK}>
            Setup page
          </Link>
          .
        </p>
      </AuthSplit>
    );
  }

  const who = 'who' in state ? state.who : null;
  const problem = problemOf(state);
  const offersConnect = state.kind === 'checking' || state.kind === 'ready' || state.kind === 'connecting';

  return (
    <AuthSplit>
      <h1 ref={heading} tabIndex={-1} className={AUTH_TITLE}>
        Connect your browser
      </h1>
      <p className={`${AUTH_BODY} wrap-anywhere`}>
        Connecting lets the Taro button in Google Meet send Taro to your calls.
        {who && (
          <>
            {' '}
            You&apos;re signed in to <span className="font-semibold text-ink">{who.workspace}</span> as{' '}
            <span className="font-semibold text-ink">{who.name}</span>.
          </>
        )}
      </p>
      {problem && (
        <Alert tone="error" className="mt-6">
          {problem}
        </Alert>
      )}
      {offersConnect && (
        <>
          <Button
            ref={button}
            size="lg"
            className="mt-6 w-full"
            // Waiting on the checks, or on the click that's already running
            pending={state.kind !== 'ready'}
            onClick={connect}
          >
            {state.kind === 'connecting' ? 'Connecting' : 'Connect this browser'}
          </Button>
          <p className="mt-4 text-sm text-ash">
            The button can send Taro to a meeting, check on it, and make it leave. It can&apos;t read transcripts or change
            settings.
          </p>
        </>
      )}
      {state.kind === 'unavailable' && (
        <Button
          ref={button}
          variant="secondary"
          size="lg"
          className="mt-6 w-full"
          onClick={() => {
            refocus.current = true;
            setState({ kind: 'checking' });
            setAttempt((n) => n + 1);
          }}
        >
          Try again
        </Button>
      )}
    </AuthSplit>
  );
}

function problemOf(state: State): string | undefined {
  switch (state.kind) {
    case 'invalid':
      return INVALID;
    case 'unsupported':
      return UNSUPPORTED;
    case 'unavailable':
    case 'refused':
      return state.message;
    case 'ready':
      return state.error;
    default:
      return undefined;
  }
}

function chromeRuntime(): Runtime | null {
  const runtime = (window as Window & { chrome?: { runtime?: Partial<Runtime> } }).chrome?.runtime;
  return typeof runtime?.sendMessage === 'function' ? (runtime as Runtime) : null;
}

/** One message to the extension. Resolves to its reply, or null when it never answers. */
function ask(runtime: Runtime, id: string, message: object): Promise<Reply | null> {
  return new Promise((resolve) => {
    const timer = window.setTimeout(() => resolve(null), REPLY_TIMEOUT_MS);
    const done = (reply: Reply | null) => {
      window.clearTimeout(timer);
      resolve(reply);
    };
    try {
      runtime.sendMessage(id, message, (reply) => {
        // Reading lastError also marks it handled, so Chrome doesn't log it as unchecked.
        done(runtime.lastError ? null : reply ?? null);
      });
    } catch {
      done(null);
    }
  });
}

/** The extension's answer in words: its own error text when it gives one, otherwise ours. */
function verdict(reply: Reply | null): { ok: true } | { ok: false; message: string } {
  if (!reply) return { ok: false, message: NO_ANSWER };
  if (reply.ok === true) return { ok: true };
  return { ok: false, message: typeof reply.error === 'string' && reply.error.trim() ? reply.error.trim().slice(0, 200) : NOT_ACCEPTED };
}

function loadError(error: unknown): string {
  if (error instanceof ApiError && error.status === 0) return error.message;
  return "Couldn't load your workspace. Check your connection and try again.";
}

function tokenError(error: unknown): string {
  // A lost connection and the API's rate limit already explain themselves.
  if (error instanceof ApiError && (error.status === 0 || error.status === 429)) return error.message;
  return "Couldn't connect this browser. Try again.";
}

// Edge, Opera, and Vivaldi also say Chrome, so they're checked first.
const BROWSERS: [RegExp, string][] = [
  [/Firefox\//, 'Firefox'],
  [/Edg\//, 'Edge'],
  [/OPR\//, 'Opera'],
  [/Vivaldi\//, 'Vivaldi'],
  [/Chrome\//, 'Chrome'],
];
// Android and ChromeOS also say Linux, and iPhones and iPads also say Mac OS X, so they're checked first.
const SYSTEMS: [RegExp, string][] = [
  [/Windows/, 'Windows'],
  [/Android/, 'Android'],
  [/CrOS/, 'ChromeOS'],
  [/iPhone|iPad/, 'iOS'],
  [/Macintosh|Mac OS X/, 'macOS'],
  [/Linux/, 'Linux'],
];

/** How this browser appears in the list of connected browsers, like "Chrome on macOS" or "Edge on Windows". */
function browserLabel(ua: string): string {
  const browser = BROWSERS.find(([pattern]) => pattern.test(ua))?.[1] ?? 'Browser';
  const os = SYSTEMS.find(([pattern]) => pattern.test(ua))?.[1];
  return os ? `${browser} on ${os}` : browser;
}
