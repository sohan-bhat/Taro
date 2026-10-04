'use client';

// GitHub permissions, the account picker after a connect, and the disconnect confirmation (9.6).

import * as React from 'react';
import { DEFAULT_GITHUB_ACTIONS, GITHUB_CAPABILITIES, type GithubAccountChoice } from '@taro/shared';
import { api } from '@/lib/api';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Dialog, DialogBody, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { SwitchRow } from '@/components/ui/switch';
import { showToast } from '@/components/ui/toast-store';
import { errorText, useOnOpen, useSessionGuard } from './common';
import { FOOTER_BUTTON } from './styles';
import { ConfirmDialog } from './workspace-dialogs';

const ON_FROM_START = GITHUB_CAPABILITIES.filter((c) => (DEFAULT_GITHUB_ACTIONS as readonly string[]).includes(c.action));
const OFF_UNTIL_TURNED_ON = GITHUB_CAPABILITIES.filter((c) => !(DEFAULT_GITHUB_ACTIONS as readonly string[]).includes(c.action));
const ALL_ACTIONS = GITHUB_CAPABILITIES.map((c) => c.action as string);

/**
 * What Taro may do on GitHub. Each switch saves at once; saves run one at a time, in order, so
 * quick toggles never land out of order. Read-only (members, the demo) shows On or Off.
 */
export function PermissionsDialog({
  open,
  enabled,
  readOnly = false,
  onClose,
  onSaved,
}: {
  open: boolean;
  enabled: readonly string[];
  readOnly?: boolean;
  onClose: () => void;
  // A save landed; the caller refreshes the "{n} of 10 on" count
  onSaved?: () => void;
}) {
  const guard = useSessionGuard();
  const [actions, setActions] = React.useState<string[]>([...enabled]);
  const [status, setStatus] = React.useState<'idle' | 'saving' | 'saved'>('idle');
  const [error, setError] = React.useState('');
  const latest = React.useRef<string[]>([...enabled]);
  const confirmed = React.useRef<string[]>([...enabled]);
  const inFlight = React.useRef(false);
  const queued = React.useRef<string[] | null>(null);

  useOnOpen(open, () => {
    latest.current = [...enabled];
    confirmed.current = [...enabled];
    setActions([...enabled]);
    setStatus('idle');
    setError('');
  });

  const show = (next: string[]) => {
    latest.current = next;
    setActions(next);
  };

  const flush = async (next: string[]) => {
    inFlight.current = true;
    setStatus('saving');
    setError('');
    try {
      const res = await api.github.setCapabilities(next);
      // The server answers with what it stored; trust what was sent if the answer has no list.
      const stored = Array.isArray(res?.enabledActions) ? res.enabledActions : next;
      confirmed.current = stored;
      if (!queued.current) {
        show(stored);
        setStatus('saved');
        onSaved?.();
      }
    } catch (e) {
      queued.current = null;
      show(confirmed.current);
      setStatus('idle');
      if (!guard(e)) setError(errorText(e, "Couldn't update GitHub permissions."));
    } finally {
      inFlight.current = false;
      const waiting = queued.current;
      queued.current = null;
      if (waiting) flush(waiting);
    }
  };

  const save = (next: string[]) => {
    show(next);
    if (inFlight.current) queued.current = next;
    else flush(next);
  };

  const toggle = (action: string, on: boolean) =>
    save(on ? [...latest.current.filter((a) => a !== action), action] : latest.current.filter((a) => a !== action));

  const group = (title: string, caps: ReadonlyArray<(typeof GITHUB_CAPABILITIES)[number]>) => (
    <div>
      <h3 className="text-meta font-semibold text-ash">{title}</h3>
      <ul className="list-none">
        {caps.map((cap) => (
          <li key={cap.action} className="border-b border-rule-soft py-3 last:border-b-0">
            <SwitchRow
              label={cap.label}
              description={cap.description}
              checked={actions.includes(cap.action)}
              readOnly={readOnly}
              onCheckedChange={(on) => toggle(cap.action, on)}
            />
          </li>
        ))}
      </ul>
    </div>
  );

  return (
    <Dialog open={open} onClose={onClose}>
      <DialogHeader>
        <DialogTitle>What Taro may do on GitHub</DialogTitle>
        <DialogDescription>Anything that&apos;s off is refused, even when someone asks out loud.</DialogDescription>
      </DialogHeader>
      <DialogBody>
        {group('On from the start', ON_FROM_START)}
        {group('Off until an owner turns it on', OFF_UNTIL_TURNED_ON)}
        {error && <Alert tone="error">{error}</Alert>}
      </DialogBody>
      <DialogFooter className="sm:items-center">
        {!readOnly && (
          <>
            <p role="status" className="text-meta text-ash sm:mr-auto">
              {status === 'saved' ? 'Saved' : status === 'saving' ? 'Saving' : ''}
            </p>
            <Button variant="ghost" className={FOOTER_BUTTON} onClick={() => save(ALL_ACTIONS)}>
              Allow all
            </Button>
          </>
        )}
        <Button className={FOOTER_BUTTON} onClick={onClose}>
          Done
        </Button>
      </DialogFooter>
    </Dialog>
  );
}

/** After connecting, when the Taro app is on more than one GitHub account the person can reach. */
export function GithubAccountDialog({
  pending,
  onDone,
  onConnected,
}: {
  pending: { token: string; choices: GithubAccountChoice[] } | null;
  onDone: () => void;
  onConnected: () => void;
}) {
  const guard = useSessionGuard();
  const [saving, setSaving] = React.useState<string | null>(null);
  const [error, setError] = React.useState('');
  // Keep the rows on screen while the dialog fades out.
  const last = React.useRef(pending);
  if (pending) last.current = pending;
  const choices = last.current?.choices ?? [];

  useOnOpen(!!pending, () => setError(''));

  const pick = async (installationId: string) => {
    if (!pending) return;
    setSaving(installationId);
    setError('');
    try {
      await api.github.connect(pending.token, installationId);
      showToast('GitHub connected.');
      onConnected();
      onDone();
    } catch (e) {
      if (!guard(e)) setError(errorText(e, "Couldn't connect that account."));
      // The rows were disabled while connecting; the one tried takes focus back.
      window.setTimeout(() => document.getElementById(`pick-${installationId}`)?.focus(), 50);
    } finally {
      setSaving(null);
    }
  };

  return (
    <Dialog open={!!pending} onClose={onDone} busy={!!saving}>
      <DialogHeader>
        <DialogTitle>Which GitHub account should Taro use?</DialogTitle>
        <DialogDescription>
          The Taro app is installed on more than one account you can reach. Taro only works in repositories you can push to.
        </DialogDescription>
      </DialogHeader>
      <DialogBody>
        <ul className="list-none space-y-2">
          {choices.map((choice) => (
            <li key={choice.installationId}>
              <button
                id={`pick-${choice.installationId}`}
                type="button"
                onClick={() => pick(choice.installationId)}
                disabled={!!saving}
                aria-busy={saving === choice.installationId || undefined}
                className="flex min-h-11 w-full items-center justify-between gap-3 rounded-control border border-field px-3.5 py-3 text-left transition-colors hover:bg-mist disabled:opacity-45 aria-busy:opacity-100"
              >
                <span className="min-w-0 truncate text-ui font-semibold text-ink">{choice.accountLogin}</span>
                <span className="shrink-0 text-meta text-ash">
                  {saving === choice.installationId
                    ? 'Connecting'
                    : `${choice.repoCount} ${choice.repoCount === 1 ? 'repository' : 'repositories'} you can push to`}
                </span>
              </button>
            </li>
          ))}
        </ul>
        {error && <Alert tone="error">{error}</Alert>}
      </DialogBody>
      <DialogFooter>
        <Button variant="ghost" className={FOOTER_BUTTON} onClick={onDone} disabled={!!saving}>
          Cancel
        </Button>
      </DialogFooter>
    </Dialog>
  );
}

export function DisconnectGithubDialog({ open, onClose, onDone }: { open: boolean; onClose: () => void; onDone: () => void }) {
  return (
    <ConfirmDialog
      open={open}
      onClose={onClose}
      title="Disconnect GitHub?"
      body="Taro stops acting on GitHub for this workspace. The app stays installed on GitHub so you can reconnect in one click. Uninstall it from your GitHub settings to revoke it completely."
      confirmLabel="Disconnect"
      pendingLabel="Disconnecting"
      fallback="Couldn't disconnect GitHub."
      onConfirm={async () => {
        await api.github.disconnect();
        showToast('GitHub disconnected.');
        onDone();
      }}
    />
  );
}
