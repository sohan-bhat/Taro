'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { api, ApiError, TOKEN_STORAGE_KEY, LICENSE_STORAGE_KEY } from '@/lib/api';
import { WaveMark, Wordmark } from '@/components/brand';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Field } from '@/components/ui/field';
import { Alert } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Spinner } from '@/components/ui/spinner';
import { Card, CardContent } from '@/components/ui/card';
import { DEMO_KEY } from '@/demo/key';

type Step = 'key' | 'activate';

const KEY_PATTERN = /^TARO(-[A-Z0-9]{4}){3}$/;
const DOMAIN_PATTERN = /^[a-z0-9][a-z0-9.-]*\.[a-z]{2,}$/i;

export default function Home() {
  const router = useRouter();
  const [checking, setChecking] = useState(true);
  const [step, setStep] = useState<Step>('key');

  const [keyInput, setKeyInput] = useState('');
  const [verifiedKey, setVerifiedKey] = useState('');
  const [name, setName] = useState('');
  const [domain, setDomain] = useState('');

  const [loading, setLoading] = useState(false);
  const [serverError, setServerError] = useState('');
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  // Returning visitor: a stored access token skips the door entirely.
  // Browsers holding a pre-token license key get migrated to a token once.
  useEffect(() => {
    const token = localStorage.getItem(TOKEN_STORAGE_KEY);
    if (token) {
      api.auth
        .session()
        .then(({ company }) => router.replace(`/dashboard/${company._id}`))
        .catch(() => {
          localStorage.removeItem(TOKEN_STORAGE_KEY);
          setChecking(false);
        });
      return;
    }

    const legacyKey = localStorage.getItem(LICENSE_STORAGE_KEY);
    if (legacyKey) {
      api.auth
        .recover(legacyKey)
        .then(({ company, accessToken }) => {
          localStorage.setItem(TOKEN_STORAGE_KEY, accessToken);
          localStorage.removeItem(LICENSE_STORAGE_KEY);
          router.replace(`/dashboard/${company._id}`);
        })
        .catch(() => {
          localStorage.removeItem(LICENSE_STORAGE_KEY);
          setChecking(false);
        });
      return;
    }

    setChecking(false);
  }, [router]);

  const handleKeySubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const key = keyInput.trim().toUpperCase();
    if (!key) {
      setFieldErrors({ key: 'Enter your license key.' });
      return;
    }
    // The demo key opens the static snapshot with no backend call, so judges
    // can explore Taro even when the live server is offline.
    if (key === DEMO_KEY) {
      router.push('/demo');
      return;
    }
    if (!KEY_PATTERN.test(key)) {
      setFieldErrors({ key: 'Keys look like TARO-XXXX-XXXX-XXXX.' });
      return;
    }
    setFieldErrors({});
    setServerError('');
    setLoading(true);
    try {
      const result = await api.licenses.lookup(key);
      if (result.status === 'claimed') {
        // Known key: proof of purchase signs the workspace back in with a
        // freshly issued access token
        const { company, accessToken } = await api.auth.recover(key);
        localStorage.setItem(TOKEN_STORAGE_KEY, accessToken);
        router.push(`/dashboard/${company._id}`);
        return;
      }
      if (result.status === 'unclaimed') {
        setVerifiedKey(key);
        setStep('activate');
      } else {
        setServerError('License key not recognized. Check the key from your purchase.');
      }
    } catch (err) {
      setServerError(err instanceof ApiError ? err.message : 'Something went wrong. Try again.');
    } finally {
      setLoading(false);
    }
  };

  const handleActivate = async (e: React.FormEvent) => {
    e.preventDefault();
    const errors: Record<string, string> = {};
    if (!name.trim()) errors.name = 'Enter your company name.';
    if (!domain.trim()) {
      errors.domain = 'Enter your email domain.';
    } else if (!DOMAIN_PATTERN.test(domain.trim())) {
      errors.domain = 'Enter a domain like acme.com.';
    }
    setFieldErrors(errors);
    if (Object.keys(errors).length > 0) return;

    setServerError('');
    setLoading(true);
    try {
      const { company, accessToken } = await api.companies.create({
        name: name.trim(),
        domain: domain.trim(),
        licenseKey: verifiedKey,
      });
      localStorage.setItem(TOKEN_STORAGE_KEY, accessToken);
      router.push(`/dashboard/${company._id}`);
    } catch (err) {
      setServerError(err instanceof ApiError ? err.message : 'Something went wrong. Try again.');
      setLoading(false);
    }
  };

  if (checking) {
    return (
      <main className="min-h-screen flex items-center justify-center">
        <Wordmark live />
      </main>
    );
  }

  return (
    <main className="min-h-screen flex flex-col">
      <header className="px-6 sm:px-10 py-6">
        <Wordmark />
      </header>

      <div className="flex-1 grid lg:grid-cols-2 gap-12 lg:gap-8 max-w-6xl w-full mx-auto px-6 sm:px-10 pb-16 items-center">
        {/* Left: what Taro is */}
        <section>
          <WaveMark live className="w-11 h-14 mb-6" />
          <h1 className="font-display font-bold text-4xl sm:text-5xl tracking-tight leading-[1.08] text-fog-900 [text-wrap:balance]">
            Say it in the meeting.
            <br />
            <span className="text-taro-600">Done before you hang up.</span>
          </h1>
          <p className="mt-5 text-lg text-fog-600 leading-relaxed max-w-xl">
            Taro joins your Google Meet calls and listens for &ldquo;Hey Taro&rdquo;. Post to
            Slack, file GitHub issues, spin up todo lists live in the meeting, confirmed with an
            audible ding while everyone keeps talking.
          </p>

          <ol className="mt-10 space-y-4 max-w-xl">
            {[
              ['Drop a Meet link in Slack', 'Taro spots it and joins the call on its own.'],
              ['Say “Hey Taro, file an issue about the login bug”', 'Spoken like a sentence, not a syntax.'],
              ['Hear the ding', 'The issue exists, the message is posted, the meeting never stopped.'],
            ].map(([title, sub], i) => (
              <li key={i} className="flex gap-4">
                <span className="shrink-0 w-7 h-7 rounded-full bg-taro-100 text-taro-700 text-sm font-display font-semibold flex items-center justify-center mt-0.5">
                  {i + 1}
                </span>
                <div>
                  <div className="font-medium text-fog-900">{title}</div>
                  <div className="text-sm text-fog-500">{sub}</div>
                </div>
              </li>
            ))}
          </ol>
        </section>

        {/* Right: the door. A license is bought first, then activated here. */}
        <section className="w-full max-w-md mx-auto lg:mx-0 lg:justify-self-end">
          <Card className="shadow-[0_1px_2px_rgba(28,25,35,0.04),0_8px_24px_-8px_rgba(28,25,35,0.08)]">
            <CardContent className="p-6 sm:p-8">
              {step === 'key' ? (
                <>
                  <h2 className="font-display font-semibold text-lg text-fog-900">
                    Activate Taro
                  </h2>
                  <p className="mt-1.5 text-sm text-fog-500 leading-relaxed">
                    Taro is licensed per company. Enter the key that came with your license.
                  </p>
                  <form onSubmit={handleKeySubmit} noValidate autoComplete="off" className="mt-6 space-y-5">
                    <Field label="License key" htmlFor="license" error={fieldErrors.key}>
                      <Input
                        id="license"
                        value={keyInput}
                        onChange={(e) => setKeyInput(e.target.value.toUpperCase())}
                        aria-invalid={!!fieldErrors.key}
                        autoComplete="off"
                        spellCheck={false}
                        className="font-mono tracking-wide"
                        placeholder="TARO-XXXX-XXXX-XXXX"
                      />
                    </Field>
                    {serverError && <Alert variant="destructive">{serverError}</Alert>}
                    <Button type="submit" disabled={loading} className="w-full">
                      {loading && <Spinner />}
                      {loading ? 'Checking' : 'Continue'}
                    </Button>
                  </form>
                  <p className="mt-4 text-xs text-fog-400">
                    First time here? The same key both activates your workspace and signs your
                    team back in later.
                  </p>
                </>
              ) : (
                <>
                  <div className="flex items-center gap-2">
                    <Badge variant="success">✓ License verified</Badge>
                    <span className="font-mono text-xs text-fog-400">{verifiedKey}</span>
                  </div>
                  <h2 className="mt-3 font-display font-semibold text-lg text-fog-900">
                    Set up your workspace
                  </h2>
                  <p className="mt-1.5 text-sm text-fog-500 leading-relaxed">
                    This key hasn&apos;t been used yet. Tell us who it belongs to.
                  </p>
                  <form onSubmit={handleActivate} noValidate autoComplete="off" className="mt-6 space-y-5">
                    <Field label="Company name" htmlFor="name" error={fieldErrors.name}>
                      <Input
                        id="name"
                        value={name}
                        onChange={(e) => setName(e.target.value)}
                        aria-invalid={!!fieldErrors.name}
                        autoComplete="off"
                        placeholder="Acme Inc"
                      />
                    </Field>
                    <Field
                      label="Email domain"
                      htmlFor="domain"
                      error={fieldErrors.domain}
                      hint="One workspace per domain."
                    >
                      <Input
                        id="domain"
                        value={domain}
                        onChange={(e) => setDomain(e.target.value)}
                        aria-invalid={!!fieldErrors.domain}
                        autoComplete="off"
                        spellCheck={false}
                        placeholder="acme.com"
                      />
                    </Field>
                    {serverError && <Alert variant="destructive">{serverError}</Alert>}
                    <Button type="submit" disabled={loading} className="w-full">
                      {loading && <Spinner />}
                      {loading ? 'Activating' : 'Activate workspace'}
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      className="w-full"
                      onClick={() => {
                        setStep('key');
                        setServerError('');
                        setFieldErrors({});
                      }}
                    >
                      Use a different key
                    </Button>
                  </form>
                </>
              )}
            </CardContent>
          </Card>
          <p className="mt-4 text-xs text-fog-400 text-center">
            Works with Slack, GitHub and Google Meet
          </p>
        </section>
      </div>
    </main>
  );
}
