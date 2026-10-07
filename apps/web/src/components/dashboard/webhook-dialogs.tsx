'use client';

// Outgoing webhooks: the Setup row and the dialog that manages a workspace's endpoints. Owners and
// admins only. One dialog walks between the list, the add or edit form, a new secret (shown once),
// and an endpoint's recent deliveries.

import * as React from 'react';
import { MAX_WEBHOOK_ENDPOINTS, WEBHOOK_EVENTS, WEBHOOK_EVENT_TYPES, type WebhookDelivery, type WebhookEndpoint } from '@taro/shared';
import { api } from '@/lib/api';
import { formatClock, timeAgo } from '@/lib/format';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Dialog, DialogBody, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Field } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Status } from '@/components/ui/status';
import { SwitchRow } from '@/components/ui/switch';
import { showToast } from '@/components/ui/toast-store';
import { errorText, useOnOpen, useSessionGuard } from './common';
import { SetupRow } from './setup';
import { FOOTER_BUTTON, ROW_BUTTON } from './styles';

const EVENT_LABELS: Record<string, string> = {
  ...Object.fromEntries(WEBHOOK_EVENTS.map((e) => [e.type, e.label])),
  'webhook.test': 'Test',
};

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

function endpointState(e: WebhookEndpoint): { text: string; tone: 'live' | 'failed' | 'ended' | 'attention' } {
  if (e.disabledForFailures) return { text: 'Turned off after failing for 3 days', tone: 'failed' };
  if (!e.enabled) return { text: 'Off', tone: 'ended' };
  if (e.failingSince) return { text: `Failing since ${timeAgo(e.failingSince)}`, tone: 'attention' };
  return { text: 'On', tone: 'live' };
}

/** The Setup row. It loads the endpoints itself, so Setup's overview stays as it is. */
export function WebhooksRow() {
  const guard = useSessionGuard();
  const [endpoints, setEndpoints] = React.useState<WebhookEndpoint[] | null>(null);
  const [error, setError] = React.useState('');
  const [open, setOpen] = React.useState(false);

  React.useEffect(() => {
    let cancelled = false;
    api.webhooks
      .list()
      .then(({ endpoints }) => !cancelled && setEndpoints(endpoints))
      .catch((e) => {
        if (!cancelled && !guard(e)) setError(errorText(e, "Couldn't load your webhooks."));
      });
    return () => {
      cancelled = true;
    };
  }, [guard]);

  const off = endpoints?.filter((e) => e.disabledForFailures).length ?? 0;
  return (
    <>
      <SetupRow
        id="setup-webhooks"
        label="Webhooks"
        state={endpoints && endpoints.length > 0 ? plural(endpoints.length, 'endpoint', 'endpoints') : endpoints ? 'Not set up' : undefined}
        purpose={error || 'Sends meetings, requests, and transcripts to your own tools, like Zapier or n8n, as signed JSON.'}
        meta={off > 0 ? `${plural(off, 'endpoint was', 'endpoints were')} turned off after failing for 3 days.` : null}
        actions={
          endpoints ? (
            <Button variant={endpoints.length ? 'secondary' : 'primary'} size="sm" className={ROW_BUTTON} onClick={() => setOpen(true)}>
              {endpoints.length ? 'Manage' : 'Add endpoint'}
            </Button>
          ) : null
        }
      />
      <WebhooksDialog open={open} endpoints={endpoints ?? []} onEndpoints={setEndpoints} onClose={() => setOpen(false)} />
    </>
  );
}

type View =
  | { name: 'list' }
  | { name: 'form'; editing?: WebhookEndpoint }
  | { name: 'secret'; endpoint: WebhookEndpoint; secret: string; fresh: boolean }
  | { name: 'deliveries'; endpoint: WebhookEndpoint };

export function WebhooksDialog({
  open,
  endpoints,
  onEndpoints,
  onClose,
}: {
  open: boolean;
  endpoints: WebhookEndpoint[];
  onEndpoints: (next: WebhookEndpoint[]) => void;
  onClose: () => void;
}) {
  const [view, setView] = React.useState<View>({ name: 'list' });
  const [busy, setBusy] = React.useState(false);

  // An empty list opens straight on the form
  useOnOpen(open, () => setView(endpoints.length ? { name: 'list' } : { name: 'form' }));

  const replace = (endpoint: WebhookEndpoint) =>
    onEndpoints(endpoints.some((e) => e._id === endpoint._id) ? endpoints.map((e) => (e._id === endpoint._id ? endpoint : e)) : [...endpoints, endpoint]);
  const back = () => (endpoints.length ? setView({ name: 'list' }) : onClose());

  return (
    <Dialog open={open} onClose={onClose} size="lg" busy={busy}>
      {view.name === 'list' && (
        <EndpointList
          endpoints={endpoints}
          onAdd={() => setView({ name: 'form' })}
          onEdit={(editing) => setView({ name: 'form', editing })}
          onDeliveries={(endpoint) => setView({ name: 'deliveries', endpoint })}
          onClose={onClose}
          setBusy={setBusy}
        />
      )}
      {view.name === 'form' && (
        <EndpointForm
          key={view.editing?._id ?? 'new'}
          editing={view.editing}
          setBusy={setBusy}
          onCancel={back}
          onSaved={(endpoint, secret) => {
            replace(endpoint);
            setView(secret ? { name: 'secret', endpoint, secret, fresh: !view.editing } : { name: 'list' });
          }}
          onDeleted={(id) => {
            const rest = endpoints.filter((e) => e._id !== id);
            onEndpoints(rest);
            if (rest.length) setView({ name: 'list' });
            else onClose();
          }}
        />
      )}
      {view.name === 'secret' && <SecretView secret={view.secret} fresh={view.fresh} onDone={() => setView({ name: 'list' })} />}
      {view.name === 'deliveries' && <DeliveriesView endpoint={view.endpoint} onBack={() => setView({ name: 'list' })} />}
    </Dialog>
  );
}

// ---------------------------------------------------------------------------------------------

function EndpointList({
  endpoints,
  onAdd,
  onEdit,
  onDeliveries,
  onClose,
  setBusy,
}: {
  endpoints: WebhookEndpoint[];
  onAdd: () => void;
  onEdit: (e: WebhookEndpoint) => void;
  onDeliveries: (e: WebhookEndpoint) => void;
  onClose: () => void;
  setBusy: (busy: boolean) => void;
}) {
  const guard = useSessionGuard();
  const [testing, setTesting] = React.useState<string | null>(null);

  const test = async (e: WebhookEndpoint) => {
    setTesting(e._id);
    setBusy(true);
    try {
      const { delivery } = await api.webhooks.test(e._id);
      if (delivery.status === 'delivered') showToast(`Test delivered. Your endpoint answered ${delivery.statusCode}.`);
      else showToast(`Test failed. ${delivery.error ?? (delivery.statusCode ? `Your endpoint answered ${delivery.statusCode}.` : '')}`.trim(), 'error');
    } catch (error) {
      if (!guard(error)) showToast(errorText(error, "Couldn't send the test."), 'error');
    } finally {
      setTesting(null);
      setBusy(false);
    }
  };

  return (
    <>
      <DialogHeader>
        <DialogTitle>Webhooks</DialogTitle>
        <DialogDescription>
          Taro sends a signed POST to each endpoint when something happens. Failed deliveries are tried again for about 3 hours.
        </DialogDescription>
      </DialogHeader>
      <DialogBody>
        <ul className="list-none">
          {endpoints.map((e) => {
            const state = endpointState(e);
            return (
              <li key={e._id} className="border-b border-rule-soft py-3.5 first:pt-0 last:border-b-0">
                <p className="font-mono text-[14px] text-ink wrap-anywhere">{e.url}</p>
                {e.description && <p className="mt-0.5 text-sm text-ink-2">{e.description}</p>}
                <p className="mt-1 text-meta text-ash">
                  <Status tone={state.tone}>{state.text}</Status>
                  {' · '}
                  {e.events.length === WEBHOOK_EVENT_TYPES.length ? 'All events' : e.events.map((t) => EVENT_LABELS[t] ?? t).join(', ')}
                </p>
                <div className="mt-2.5 flex flex-wrap gap-2">
                  <Button variant="secondary" size="sm" onClick={() => test(e)} pending={testing === e._id} disabled={!!testing && testing !== e._id}>
                    {testing === e._id ? 'Sending' : 'Send test'}
                  </Button>
                  <Button variant="ghost" size="sm" onClick={() => onDeliveries(e)}>
                    Deliveries
                  </Button>
                  <Button variant="ghost" size="sm" onClick={() => onEdit(e)}>
                    Edit
                  </Button>
                </div>
              </li>
            );
          })}
        </ul>
      </DialogBody>
      <DialogFooter>
        {endpoints.length < MAX_WEBHOOK_ENDPOINTS && (
          <Button variant="ghost" className={FOOTER_BUTTON} onClick={onAdd}>
            Add endpoint
          </Button>
        )}
        <Button className={FOOTER_BUTTON} onClick={onClose}>
          Done
        </Button>
      </DialogFooter>
    </>
  );
}

// ---------------------------------------------------------------------------------------------

function EndpointForm({
  editing,
  setBusy,
  onCancel,
  onSaved,
  onDeleted,
}: {
  editing?: WebhookEndpoint;
  setBusy: (busy: boolean) => void;
  onCancel: () => void;
  // A new or rotated secret comes with it, to show once
  onSaved: (endpoint: WebhookEndpoint, secret?: string) => void;
  onDeleted: (id: string) => void;
}) {
  const guard = useSessionGuard();
  const [url, setUrl] = React.useState(editing?.url ?? '');
  const [description, setDescription] = React.useState(editing?.description ?? '');
  const [events, setEvents] = React.useState<string[]>(editing?.events ?? [...WEBHOOK_EVENT_TYPES]);
  const [enabled, setEnabled] = React.useState(editing?.enabled ?? true);
  const [working, setWorking] = React.useState<'save' | 'rotate' | 'delete' | null>(null);
  const [confirmDelete, setConfirmDelete] = React.useState(false);
  const [error, setError] = React.useState('');
  const [urlError, setUrlError] = React.useState('');

  const run = async (what: 'save' | 'rotate' | 'delete', work: () => Promise<void>, fallback: string) => {
    setWorking(what);
    setBusy(true);
    setError('');
    try {
      await work();
    } catch (e) {
      if (!guard(e)) setError(errorText(e, fallback));
    } finally {
      setWorking(null);
      setBusy(false);
    }
  };

  const save = (e: React.FormEvent) => {
    e.preventDefault();
    if (!/^https?:\/\//i.test(url.trim())) {
      setUrlError('Enter the full URL, starting with https://.');
      return;
    }
    setUrlError('');
    if (events.length === 0) {
      setError('Choose at least one event to send.');
      return;
    }
    run(
      'save',
      async () => {
        if (editing) {
          const { endpoint } = await api.webhooks.update(editing._id, { url: url.trim(), description: description.trim(), events, enabled });
          showToast('Endpoint saved.');
          onSaved(endpoint);
        } else {
          const { endpoint, secret } = await api.webhooks.create({ url: url.trim(), description: description.trim() || undefined, events });
          onSaved(endpoint, secret);
        }
      },
      "Couldn't save the endpoint."
    );
  };

  return (
    <form onSubmit={save} noValidate>
      <DialogHeader>
        <DialogTitle>{editing ? 'Edit endpoint' : 'Add an endpoint'}</DialogTitle>
        <DialogDescription>
          {editing
            ? 'Changes apply to the next event Taro sends.'
            : 'Paste the URL from Zapier, n8n, Make, or your own server. Taro checks that it reaches the public internet.'}
        </DialogDescription>
      </DialogHeader>
      <DialogBody>
        <Field label="URL" htmlFor="webhook-url" error={urlError} hint="Use https. Taro doesn't follow redirects.">
          <Input
            id="webhook-url"
            type="url"
            inputMode="url"
            autoComplete="off"
            spellCheck={false}
            placeholder="https://hooks.example.com/taro"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            className="font-mono text-[14px]"
          />
        </Field>
        <Field label="Description" htmlFor="webhook-description" hint="Optional. Something to tell your endpoints apart.">
          <Input id="webhook-description" maxLength={120} value={description} onChange={(e) => setDescription(e.target.value)} />
        </Field>
        <fieldset>
          <legend className="text-meta font-semibold text-ash">Events</legend>
          <ul className="list-none">
            {WEBHOOK_EVENTS.map((event) => (
              <li key={event.type} className="border-b border-rule-soft py-3 last:border-b-0">
                <SwitchRow
                  label={event.label}
                  description={event.description}
                  checked={events.includes(event.type)}
                  onCheckedChange={(on) => setEvents((now) => (on ? [...now.filter((t) => t !== event.type), event.type] : now.filter((t) => t !== event.type)))}
                />
              </li>
            ))}
          </ul>
        </fieldset>
        {editing && (
          <div className="space-y-3 border-t border-rule-soft pt-4">
            <SwitchRow
              label="On"
              description={editing.disabledForFailures ? 'Taro turned this off after it failed for 3 days. Turn it on to try again.' : 'Off stops sending until you turn it back on.'}
              checked={enabled}
              onCheckedChange={setEnabled}
            />
            <p className="text-meta text-ash">
              Signing secret <span className="font-mono">{editing.secretHint}</span>
            </p>
            <div className="flex flex-wrap gap-2">
              <Button
                type="button"
                variant="secondary"
                size="sm"
                pending={working === 'rotate'}
                disabled={!!working}
                onClick={() =>
                  run(
                    'rotate',
                    async () => {
                      const { endpoint, secret } = await api.webhooks.rotate(editing._id);
                      onSaved(endpoint, secret);
                    },
                    "Couldn't rotate the secret."
                  )
                }
              >
                {working === 'rotate' ? 'Rotating' : 'Rotate secret'}
              </Button>
              <Button
                type="button"
                variant={confirmDelete ? 'danger' : 'destructive'}
                size="sm"
                pending={working === 'delete'}
                disabled={!!working && working !== 'delete'}
                onClick={() =>
                  confirmDelete
                    ? run(
                        'delete',
                        async () => {
                          await api.webhooks.remove(editing._id);
                          showToast('Endpoint deleted.');
                          onDeleted(editing._id);
                        },
                        "Couldn't delete the endpoint."
                      )
                    : setConfirmDelete(true)
                }
              >
                {working === 'delete' ? 'Deleting' : confirmDelete ? 'Delete it and its history' : 'Delete endpoint'}
              </Button>
            </div>
          </div>
        )}
        {error && <Alert tone="error">{error}</Alert>}
      </DialogBody>
      <DialogFooter>
        <Button type="button" variant="ghost" className={FOOTER_BUTTON} onClick={onCancel} disabled={!!working}>
          Cancel
        </Button>
        <Button type="submit" className={FOOTER_BUTTON} pending={working === 'save'} disabled={!!working && working !== 'save'}>
          {working === 'save' ? 'Saving' : editing ? 'Save' : 'Add endpoint'}
        </Button>
      </DialogFooter>
    </form>
  );
}

// ---------------------------------------------------------------------------------------------

function SecretView({ secret, fresh, onDone }: { secret: string; fresh: boolean; onDone: () => void }) {
  const [copied, setCopied] = React.useState(false);
  React.useEffect(() => {
    if (!copied) return;
    const timer = window.setTimeout(() => setCopied(false), 2000);
    return () => window.clearTimeout(timer);
  }, [copied]);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(secret);
      setCopied(true);
    } catch {
      showToast("Couldn't copy it. Select the secret and copy it yourself.", 'error');
    }
  };

  return (
    <>
      <DialogHeader>
        <DialogTitle>{fresh ? 'Endpoint added' : 'New signing secret'}</DialogTitle>
        <DialogDescription>
          Copy this secret now. Taro won&apos;t show it again. Use it to check the Taro-Signature header on each request.
          {fresh ? '' : ' The old secret stopped working just now.'}
        </DialogDescription>
      </DialogHeader>
      <DialogBody>
        <div className="flex flex-col gap-2 rounded-control border border-field bg-poi p-3.5 sm:flex-row sm:items-center">
          <code className="min-w-0 flex-1 font-mono text-[14px] text-ink wrap-anywhere">{secret}</code>
          <Button variant="secondary" size="sm" className="shrink-0" onClick={copy}>
            {copied ? 'Copied' : 'Copy'}
          </Button>
        </div>
      </DialogBody>
      <DialogFooter>
        <Button className={FOOTER_BUTTON} onClick={onDone}>
          I copied it
        </Button>
      </DialogFooter>
    </>
  );
}

// ---------------------------------------------------------------------------------------------

function deliveryState(d: WebhookDelivery): { text: string; tone: 'live' | 'failed' | 'attention' | 'neutral' } {
  const code = d.statusCode ? ` ${d.statusCode}` : '';
  if (d.status === 'delivered') return { text: `Delivered${code}`, tone: 'live' };
  if (d.status === 'failed') return { text: `Failed${code}`, tone: 'failed' };
  if (d.attempts === 0) return { text: 'Sending', tone: 'neutral' };
  return { text: `Retrying${code}`, tone: 'attention' };
}

function DeliveriesView({ endpoint, onBack }: { endpoint: WebhookEndpoint; onBack: () => void }) {
  const guard = useSessionGuard();
  const [deliveries, setDeliveries] = React.useState<WebhookDelivery[] | null>(null);
  const [error, setError] = React.useState('');
  const [loading, setLoading] = React.useState(false);

  const load = React.useCallback(async () => {
    setLoading(true);
    try {
      const { deliveries } = await api.webhooks.deliveries(endpoint._id);
      setDeliveries(deliveries);
      setError('');
    } catch (e) {
      if (!guard(e)) setError(errorText(e, "Couldn't load the deliveries."));
    } finally {
      setLoading(false);
    }
  }, [endpoint._id, guard]);

  React.useEffect(() => {
    load();
  }, [load]);

  return (
    <>
      <DialogHeader>
        <DialogTitle>Recent deliveries</DialogTitle>
        <DialogDescription className="font-mono text-[14px] wrap-anywhere">{endpoint.url}</DialogDescription>
      </DialogHeader>
      <DialogBody>
        {error ? (
          <Alert tone="error">{error}</Alert>
        ) : !deliveries ? (
          <p className="text-meta text-ash">Loading deliveries</p>
        ) : deliveries.length === 0 ? (
          <p className="text-sm text-ink-2">Nothing sent yet. Send a test, or wait for the next meeting.</p>
        ) : (
          <ul className="list-none">
            {deliveries.map((d) => {
              const state = deliveryState(d);
              return (
                <li key={d._id} className="border-b border-rule-soft py-2.5 first:pt-0 last:border-b-0">
                  <div className="flex items-baseline justify-between gap-3">
                    <span className="text-ui font-semibold text-ink">{EVENT_LABELS[d.type] ?? d.type}</span>
                    <Status tone={state.tone}>{state.text}</Status>
                  </div>
                  <p className="text-meta text-ash">
                    {timeAgo(d.createdAt)}
                    {d.attempts > 1 ? ` · ${d.attempts} tries` : ''}
                    {d.durationMs !== undefined ? ` · ${d.durationMs} ms` : ''}
                    {d.nextAttemptAt ? ` · next try at ${formatClock(d.nextAttemptAt)}` : ''}
                  </p>
                  {d.error && d.status !== 'delivered' && <p className="mt-0.5 text-sm text-ink-2 wrap-anywhere">{d.error}</p>}
                </li>
              );
            })}
          </ul>
        )}
      </DialogBody>
      <DialogFooter>
        <Button variant="ghost" className={FOOTER_BUTTON} onClick={load} pending={loading}>
          {loading ? 'Refreshing' : 'Refresh'}
        </Button>
        <Button className={FOOTER_BUTTON} onClick={onBack}>
          Back
        </Button>
      </DialogFooter>
    </>
  );
}
