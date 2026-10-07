'use client';

// Linear and Jira: what Taro may do in each, pasting the Jira connection key, and disconnecting.

import * as React from 'react';
import { DEFAULT_TICKET_ACTIONS, TICKET_CAPABILITIES, TRACKERS, type TrackerId, type TrackerStatus } from '@taro/shared';
import { api } from '@/lib/api';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Dialog, DialogBody, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Field } from '@/components/ui/field';
import { SecretInput } from '@/components/ui/secret-input';
import { showToast } from '@/components/ui/toast-store';
import { CapabilitiesDialog } from './capabilities-dialog';
import { errorText, useOnOpen, useSessionGuard } from './common';
import { FOOTER_BUTTON, LINK } from './styles';
import { ConfirmDialog } from './workspace-dialogs';

export function TicketPermissionsDialog({
  tracker,
  enabled,
  readOnly = false,
  onClose,
  onSaved,
}: {
  // The tracker whose permissions are open, or null when closed
  tracker: TrackerId | null;
  enabled: readonly string[];
  readOnly?: boolean;
  onClose: () => void;
  onSaved?: () => void;
}) {
  // Keep the title while the dialog fades out
  const last = React.useRef<TrackerId>('linear');
  if (tracker) last.current = tracker;
  const id = last.current;
  return (
    <CapabilitiesDialog
      open={!!tracker}
      title={`What Taro may do in ${TRACKERS[id]}`}
      capabilities={TICKET_CAPABILITIES}
      defaults={DEFAULT_TICKET_ACTIONS}
      enabled={enabled}
      readOnly={readOnly}
      save={id === 'linear' ? api.linear.setCapabilities : api.jira.setCapabilities}
      failText={`Couldn't update ${TRACKERS[id]} permissions.`}
      onClose={onClose}
      onSaved={onSaved}
    />
  );
}

/**
 * Connecting Jira: install the Taro app for Jira on the site, make a key on its page in Jira, paste
 * it here. The key is checked by reading the site's projects through the app before it's saved.
 */
export function JiraKeyDialog({
  open,
  jira,
  onClose,
  onConnected,
}: {
  open: boolean;
  jira: TrackerStatus;
  onClose: () => void;
  onConnected: () => void;
}) {
  const guard = useSessionGuard();
  const [key, setKey] = React.useState('');
  const [keyError, setKeyError] = React.useState('');
  const [error, setError] = React.useState('');
  const [saving, setSaving] = React.useState(false);
  const [installUrl, setInstallUrl] = React.useState<string | null>(null);
  const keyRef = React.useRef<HTMLInputElement>(null);

  useOnOpen(open, () => {
    setKey('');
    setKeyError('');
    setError('');
    api.jira
      .installUrl()
      .then(({ url }) => setInstallUrl(url))
      .catch(() => setInstallUrl(null));
  });

  const save = async () => {
    const value = key.trim();
    if (!value) {
      setKeyError('Paste the connection key from the Taro page in Jira.');
      keyRef.current?.focus();
      return;
    }
    setSaving(true);
    setError('');
    try {
      const { jira: next } = await api.jira.connect(value);
      showToast(`Jira connected${next.siteName ? ` to ${next.siteName}` : ''}.`);
      onConnected();
      onClose();
    } catch (e) {
      if (!guard(e)) setError(errorText(e, "Couldn't connect Jira with that key."));
      keyRef.current?.focus();
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onClose={onClose} busy={saving}>
      <form
        noValidate
        onSubmit={(e) => {
          e.preventDefault();
          if (!saving) save();
        }}
      >
        <DialogHeader>
          <DialogTitle>{jira.connected ? 'Paste a new Jira key' : 'Connect Jira'}</DialogTitle>
          <DialogDescription>Taro works in Jira through its own app, so tickets come from Taro, never from you.</DialogDescription>
        </DialogHeader>
        <DialogBody>
          <ol className="list-decimal space-y-1.5 pl-5 text-ui text-ink-2">
            <li>
              A Jira admin{' '}
              {installUrl ? (
                <a href={installUrl} target="_blank" rel="noreferrer" className={LINK}>
                  installs the Taro app for Jira
                </a>
              ) : (
                'installs the Taro app for Jira'
              )}{' '}
              on your site.
            </li>
            <li>In Jira, they open Settings, then Apps, then Taro, and make a connection key.</li>
            <li>Paste the key here.</li>
          </ol>
          <Field label="Connection key" htmlFor="jira-key" hint="Taro checks it by reading your projects, then stores it encrypted." error={keyError}>
            <SecretInput
              ref={keyRef}
              id="jira-key"
              value={key}
              onChange={(e) => {
                setKey(e.target.value);
                if (keyError) setKeyError('');
              }}
              placeholder="taro-jira-1.…"
            />
          </Field>
          {error && <Alert tone="error">{error}</Alert>}
        </DialogBody>
        <DialogFooter>
          <Button variant="ghost" className={FOOTER_BUTTON} onClick={onClose} disabled={saving}>
            Cancel
          </Button>
          <Button type="submit" className={FOOTER_BUTTON} pending={saving}>
            {saving ? 'Checking key' : 'Connect Jira'}
          </Button>
        </DialogFooter>
      </form>
    </Dialog>
  );
}

export function DisconnectTrackerDialog({
  tracker,
  onClose,
  onDone,
}: {
  tracker: TrackerId | null;
  onClose: () => void;
  onDone: () => void;
}) {
  const last = React.useRef<TrackerId>('linear');
  if (tracker) last.current = tracker;
  const id = last.current;
  return (
    <ConfirmDialog
      open={!!tracker}
      onClose={onClose}
      title={`Disconnect ${TRACKERS[id]}?`}
      body={
        id === 'linear'
          ? "Taro stops working in Linear for this workspace, and its access is revoked at Linear. Connecting again installs the app again."
          : 'Taro forgets the connection key and stops working in Jira for this workspace. The app stays installed in Jira until a Jira admin removes it there.'
      }
      confirmLabel="Disconnect"
      pendingLabel="Disconnecting"
      fallback={`Couldn't disconnect ${TRACKERS[id]}.`}
      onConfirm={async () => {
        await (id === 'linear' ? api.linear.disconnect() : api.jira.disconnect());
        showToast(`${TRACKERS[id]} disconnected.`);
        onDone();
      }}
    />
  );
}
