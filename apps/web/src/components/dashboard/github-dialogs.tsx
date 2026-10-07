'use client';

// GitHub permissions, the account picker after a connect, and the disconnect confirmation (9.6).

import * as React from 'react';
import { DEFAULT_GITHUB_ACTIONS, GITHUB_CAPABILITIES, type GithubAccountChoice } from '@taro/shared';
import { api } from '@/lib/api';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Dialog, DialogBody, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { showToast } from '@/components/ui/toast-store';
import { errorText, useOnOpen, useSessionGuard } from './common';
import { FOOTER_BUTTON } from './styles';
import { CapabilitiesDialog } from './capabilities-dialog';
import { ConfirmDialog } from './workspace-dialogs';

/** What Taro may do on GitHub. */
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
  onSaved?: () => void;
}) {
  return (
    <CapabilitiesDialog
      open={open}
      title="What Taro may do on GitHub"
      capabilities={GITHUB_CAPABILITIES}
      defaults={DEFAULT_GITHUB_ACTIONS}
      enabled={enabled}
      readOnly={readOnly}
      save={api.github.setCapabilities}
      failText="Couldn't update GitHub permissions."
      onClose={onClose}
      onSaved={onSaved}
    />
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
