'use client';

// What Taro may do in one connection, as switches: GitHub, Linear, or Jira.

import * as React from 'react';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Dialog, DialogBody, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { SwitchRow } from '@/components/ui/switch';
import { errorText, useOnOpen, useSessionGuard } from './common';
import { FOOTER_BUTTON } from './styles';

export interface Capability {
  action: string;
  label: string;
  description: string;
}

/**
 * Each switch saves at once; saves run one at a time, in order, so quick toggles never land out of
 * order. Read-only (members, the demo) shows On or Off.
 */
export function CapabilitiesDialog({
  open,
  title,
  capabilities,
  defaults,
  enabled,
  readOnly = false,
  save: saveRemote,
  failText,
  onClose,
  onSaved,
}: {
  open: boolean;
  title: string;
  capabilities: readonly Capability[];
  // On from the start; the rest are listed as off until an owner turns them on
  defaults: readonly string[];
  enabled: readonly string[];
  readOnly?: boolean;
  save: (actions: string[]) => Promise<{ enabledActions?: string[] }>;
  failText: string;
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
      const res = await saveRemote(next);
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
      if (!guard(e)) setError(errorText(e, failText));
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

  const group = (heading: string, caps: readonly Capability[]) => (
    <div>
      <h3 className="text-meta font-semibold text-ash">{heading}</h3>
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
        <DialogTitle>{title}</DialogTitle>
        <DialogDescription>Anything that&apos;s off is refused, even when someone asks out loud.</DialogDescription>
      </DialogHeader>
      <DialogBody>
        {group('On from the start', capabilities.filter((c) => defaults.includes(c.action)))}
        {group('Off until an owner turns it on', capabilities.filter((c) => !defaults.includes(c.action)))}
        {error && <Alert tone="error">{error}</Alert>}
      </DialogBody>
      <DialogFooter className="sm:items-center">
        {!readOnly && (
          <>
            <p role="status" className="text-meta text-ash sm:mr-auto">
              {status === 'saved' ? 'Saved' : status === 'saving' ? 'Saving' : ''}
            </p>
            <Button variant="ghost" className={FOOTER_BUTTON} onClick={() => save(capabilities.map((c) => c.action))}>
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
