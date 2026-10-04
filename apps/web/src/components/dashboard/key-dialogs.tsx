'use client';

// The three key dialogs (9.6): the meeting bot, the AI model, and transcription. Every key is
// checked with its provider before it's stored, and a saved key is never shown again; the
// dialogs only ever see its hint.

import * as React from 'react';
import {
  LLM_PROVIDERS,
  MEETING_BOT_PROVIDER,
  STT_PROVIDERS,
  getLlmProvider,
  getSttProvider,
  type LlmProviderId,
  type ProviderSettings,
  type SttProviderId,
} from '@taro/shared';
import { api } from '@/lib/api';
import { cn } from '@/lib/utils';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Dialog, DialogBody, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Field } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { SecretInput } from '@/components/ui/secret-input';
import { Select } from '@/components/ui/select';
import { showToast } from '@/components/ui/toast-store';
import { errorText, useOnOpen, useSessionGuard } from './common';
import { FOOTER_BUTTON, LINK } from './styles';

export type KeySlot = 'meetingBot' | 'llm' | 'stt';

/** Opens one of the three dialogs. Each shows its own toast; `onSaved` gets the new masked settings. */
export function KeyDialogs({
  editing,
  providers,
  serverStt,
  onClose,
  onSaved,
}: {
  editing: KeySlot | null;
  providers: ProviderSettings;
  // The server hosts transcription itself, so "Built-in" is offered
  serverStt: boolean;
  onClose: () => void;
  onSaved: (providers: ProviderSettings) => void;
}) {
  return (
    <>
      <MeetingBotDialog open={editing === 'meetingBot'} providers={providers} onClose={onClose} onSaved={onSaved} />
      <LlmDialog open={editing === 'llm'} providers={providers} onClose={onClose} onSaved={onSaved} />
      <SttDialog open={editing === 'stt'} providers={providers} serverStt={serverStt} onClose={onClose} onSaved={onSaved} />
    </>
  );
}

// "sk-ant-..." shows as the key prefix "sk-ant-"; placeholders that aren't a prefix show nothing.
const prefixOf = (placeholder: string) => (placeholder.endsWith('...') ? placeholder.slice(0, -3) : undefined);
const lowerFirst = (s: string) => s.charAt(0).toLowerCase() + s.slice(1);

interface Tile<T extends string> {
  id: T;
  name: string;
  tagline: string;
  prefix?: string;
}

/** Provider tiles: a radio group, so arrow keys move the choice and only the chosen tile is a tab stop. */
function ProviderTiles<T extends string>({
  label,
  tiles,
  value,
  onChange,
  className,
}: {
  label: string;
  tiles: ReadonlyArray<Tile<T>>;
  value: T;
  onChange: (id: T) => void;
  className?: string;
}) {
  const refs = React.useRef<Array<HTMLButtonElement | null>>([]);
  const chosen = Math.max(0, tiles.findIndex((t) => t.id === value));
  const move = (from: number, by: number) => {
    const to = (from + by + tiles.length) % tiles.length;
    onChange(tiles[to].id);
    refs.current[to]?.focus();
  };
  return (
    <div role="radiogroup" aria-label={label} className={cn('grid grid-cols-2 gap-2', className)}>
      {tiles.map((tile, i) => {
        const on = tile.id === value;
        return (
          <button
            key={tile.id}
            ref={(el) => {
              refs.current[i] = el;
            }}
            type="button"
            role="radio"
            aria-checked={on}
            tabIndex={i === chosen ? 0 : -1}
            onClick={() => onChange(tile.id)}
            onKeyDown={(e) => {
              if (e.key === 'ArrowRight' || e.key === 'ArrowDown') {
                e.preventDefault();
                move(i, 1);
              } else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') {
                e.preventDefault();
                move(i, -1);
              }
            }}
            className={cn(
              'min-w-0 rounded-control border border-field p-[11px] text-left transition-colors hover:bg-mist',
              on && 'border-2 border-taro bg-poi p-[10px] hover:bg-poi'
            )}
          >
            <span className="block text-ui font-semibold text-ink">{tile.name}</span>
            <span className="block text-xs text-ash">{tile.tagline}</span>
            {tile.prefix && <span className="mt-0.5 block font-mono text-xs text-ash">{tile.prefix}</span>}
          </button>
        );
      })}
    </div>
  );
}

/**
 * "Remove key": a button in the footer, then an inline confirmation above it (the same ruled
 * note members use). The slot is cleared on the server and the dialog closes.
 */
function useRemoval({
  slot,
  done,
  onRemoved,
}: {
  slot: 'meeting-bot' | 'llm' | 'stt';
  // The toast, for example "MeetingBaas key removed."
  done: string;
  onRemoved: (providers: ProviderSettings) => void;
}) {
  const guard = useSessionGuard();
  const [asking, setAsking] = React.useState(false);
  const [removing, setRemoving] = React.useState(false);
  const [error, setError] = React.useState('');
  const triggerRef = React.useRef<HTMLButtonElement>(null);
  const cancelRef = React.useRef<HTMLButtonElement>(null);

  React.useEffect(() => {
    if (asking) cancelRef.current?.focus();
  }, [asking]);

  const reset = () => {
    setAsking(false);
    setError('');
  };

  const remove = async () => {
    setRemoving(true);
    setError('');
    try {
      const { providers } = await api.providers.remove(slot);
      showToast(done);
      setAsking(false);
      onRemoved(providers);
    } catch (e) {
      if (!guard(e)) setError(errorText(e, "Couldn't remove it."));
      // The buttons were disabled while removing; the question keeps focus.
      window.setTimeout(() => cancelRef.current?.focus(), 50);
    } finally {
      setRemoving(false);
    }
  };

  const confirmNote = (question: string) =>
    asking ? (
      <Alert tone="error">
        <p>{question}</p>
        {error && <p className="mt-2">{error}</p>}
        <div className="mt-3 flex justify-end gap-2">
          <Button
            ref={cancelRef}
            variant="ghost"
            size="sm"
            disabled={removing}
            onClick={() => {
              setAsking(false);
              // The footer button comes back once the note closes.
              window.setTimeout(() => triggerRef.current?.focus(), 0);
            }}
          >
            Cancel
          </Button>
          <Button variant="danger" size="sm" onClick={remove} pending={removing}>
            {removing ? 'Removing' : 'Remove'}
          </Button>
        </div>
      </Alert>
    ) : null;

  const footerButton = (label: string, disabled: boolean) =>
    asking ? null : (
      <Button ref={triggerRef} variant="destructive" className={cn(FOOTER_BUTTON, 'sm:mr-auto')} disabled={disabled} onClick={() => setAsking(true)}>
        {label}
      </Button>
    );

  return { asking, removing, reset, confirmNote, footerButton };
}

// ---------------------------------------------------------------------------------------------

function MeetingBotDialog({
  open,
  providers,
  onClose,
  onSaved,
}: {
  open: boolean;
  providers: ProviderSettings;
  onClose: () => void;
  onSaved: (providers: ProviderSettings) => void;
}) {
  const guard = useSessionGuard();
  const configured = providers.meetingBot.configured;
  const [key, setKey] = React.useState('');
  const [keyError, setKeyError] = React.useState('');
  const [saving, setSaving] = React.useState(false);
  const [error, setError] = React.useState('');
  const keyRef = React.useRef<HTMLInputElement>(null);
  const removal = useRemoval({ slot: 'meeting-bot', done: 'MeetingBaas key removed.', onRemoved: onSaved });

  useOnOpen(open, () => {
    setKey('');
    setKeyError('');
    setError('');
    removal.reset();
  });

  const save = async () => {
    const value = key.trim();
    if (!value) {
      setKeyError('Paste your MeetingBaas API key.');
      keyRef.current?.focus();
      return;
    }
    setSaving(true);
    setError('');
    try {
      const { providers: next } = await api.providers.setMeetingBot(value);
      showToast('Meeting bot connected.');
      onSaved(next);
    } catch (e) {
      if (!guard(e)) setError(errorText(e, "Couldn't save the key."));
      // Back to the key, which is most likely what needs fixing.
      keyRef.current?.focus();
    } finally {
      setSaving(false);
    }
  };

  const busy = saving || removal.removing;
  return (
    <Dialog open={open} onClose={onClose} busy={busy}>
      <form
        noValidate
        onSubmit={(e) => {
          e.preventDefault();
          if (!busy && !removal.asking) save();
        }}
      >
        <DialogHeader>
          <DialogTitle>{configured ? 'Replace your MeetingBaas key' : 'Connect your meeting bot'}</DialogTitle>
          <DialogDescription>
            Taro uses your MeetingBaas account to send a bot into each call. Create an API key in your{' '}
            <a href={MEETING_BOT_PROVIDER.keyUrl} target="_blank" rel="noreferrer" className={LINK}>
              MeetingBaas dashboard
            </a>
            , then paste it here.
          </DialogDescription>
        </DialogHeader>
        <DialogBody className={removal.asking ? 'pb-6 sm:pb-7' : undefined}>
          <Field label="MeetingBaas API key" htmlFor="mb-key" hint="Taro checks it with MeetingBaas, then stores it encrypted." error={keyError}>
            <SecretInput
              ref={keyRef}
              id="mb-key"
              value={key}
              onChange={(e) => {
                setKey(e.target.value);
                if (keyError) setKeyError('');
              }}
              placeholder={MEETING_BOT_PROVIDER.keyPlaceholder}
            />
          </Field>
          {error && <Alert tone="error">{error}</Alert>}
          {removal.confirmNote("Remove the MeetingBaas key? Taro can't join meetings until someone adds a key again.")}
        </DialogBody>
        {/* While the removal question is open, its two buttons are the only choice. */}
        <DialogFooter className={removal.asking ? 'hidden' : undefined}>
          {configured && removal.footerButton('Remove key', busy)}
          <Button variant="ghost" className={FOOTER_BUTTON} onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button type="submit" className={FOOTER_BUTTON} pending={saving} disabled={removal.removing}>
            {saving ? 'Checking key' : 'Save key'}
          </Button>
        </DialogFooter>
      </form>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------------------------

const OTHER_MODEL = '__other__';

const LLM_TILES: ReadonlyArray<Tile<LlmProviderId>> = LLM_PROVIDERS.map((p) => ({
  id: p.id,
  name: p.name,
  tagline: p.tagline,
  prefix: prefixOf(p.keyPlaceholder),
}));

function LlmDialog({
  open,
  providers,
  onClose,
  onSaved,
}: {
  open: boolean;
  providers: ProviderSettings;
  onClose: () => void;
  onSaved: (providers: ProviderSettings) => void;
}) {
  const guard = useSessionGuard();
  const current = providers.llm;
  const [provider, setProvider] = React.useState<LlmProviderId>('anthropic');
  const [model, setModel] = React.useState('');
  const [customModel, setCustomModel] = React.useState('');
  const [baseUrl, setBaseUrl] = React.useState('');
  const [key, setKey] = React.useState('');
  const [fieldErrors, setFieldErrors] = React.useState<{ baseUrl?: string; model?: string; key?: string }>({});
  const [saving, setSaving] = React.useState(false);
  const [error, setError] = React.useState('');
  const refs = {
    baseUrl: React.useRef<HTMLInputElement>(null),
    model: React.useRef<HTMLInputElement>(null),
    key: React.useRef<HTMLInputElement>(null),
  };
  const removal = useRemoval({ slot: 'llm', done: 'AI model removed.', onRemoved: onSaved });

  const info = getLlmProvider(provider) ?? LLM_PROVIDERS[0];
  // The stored key stays when the provider doesn't change, so the key field can be left blank.
  const keepingKey = current.configured && current.provider === provider;

  useOnOpen(open, () => {
    const startInfo = getLlmProvider(current.provider) ?? LLM_PROVIDERS[0];
    const known = startInfo.models.some((m) => m.id === current.model);
    setProvider(startInfo.id);
    setModel(current.model && !known ? OTHER_MODEL : current.model || (startInfo.models.length ? startInfo.defaultModel : OTHER_MODEL));
    setCustomModel(current.model && !known ? current.model : '');
    setBaseUrl(current.baseUrl ?? '');
    setKey('');
    setFieldErrors({});
    setError('');
    removal.reset();
  });

  const choose = (id: LlmProviderId) => {
    const next = getLlmProvider(id) ?? LLM_PROVIDERS[0];
    setProvider(next.id);
    setModel(next.models.length ? next.defaultModel : OTHER_MODEL);
    setCustomModel('');
    setFieldErrors({});
    setError('');
  };

  const typingModel = model === OTHER_MODEL || info.models.length === 0;
  const resolvedModel = typingModel ? customModel.trim() : model;

  const save = async () => {
    const problems: typeof fieldErrors = {};
    if (info.needsBaseUrl && !baseUrl.trim()) problems.baseUrl = 'Enter the base URL.';
    if (!resolvedModel) problems.model = 'Enter the model name, exactly as your provider spells it.';
    if (!keepingKey && !key.trim()) problems.key = `Paste your ${info.name} API key.`;
    setFieldErrors(problems);
    const first = (['baseUrl', 'model', 'key'] as const).find((k) => problems[k]);
    if (first) {
      refs[first].current?.focus();
      return;
    }
    setSaving(true);
    setError('');
    try {
      const { providers: next } = await api.providers.setLlm({
        provider,
        model: resolvedModel,
        ...(key.trim() ? { apiKey: key.trim() } : {}),
        ...(info.needsBaseUrl ? { baseUrl: baseUrl.trim() } : {}),
      });
      showToast('AI model saved.');
      onSaved(next);
    } catch (e) {
      if (!guard(e)) setError(errorText(e, "Couldn't save the model."));
      (refs.key.current ?? document.querySelector<HTMLElement>('[data-dialog-panel]'))?.focus();
    } finally {
      setSaving(false);
    }
  };

  const clear = (field: keyof typeof fieldErrors) => fieldErrors[field] && setFieldErrors((f) => ({ ...f, [field]: undefined }));
  const busy = saving || removal.removing;

  return (
    <Dialog open={open} onClose={onClose} busy={busy} size="lg">
      <form
        noValidate
        onSubmit={(e) => {
          e.preventDefault();
          if (!busy && !removal.asking) save();
        }}
      >
        <DialogHeader>
          <DialogTitle>Choose your AI model</DialogTitle>
          <DialogDescription>
            Taro sends each spoken request to this model to work out what to do. Usage is billed to your account with the
            provider.
          </DialogDescription>
        </DialogHeader>
        <DialogBody className={removal.asking ? 'pb-6 sm:pb-7' : undefined}>
          <ProviderTiles label="Provider" tiles={LLM_TILES} value={provider} onChange={choose} className="sm:grid-cols-3" />

          {info.needsBaseUrl && (
            <Field label="Base URL" htmlFor="llm-base" hint="An OpenAI-compatible API, for example https://api.together.xyz/v1" error={fieldErrors.baseUrl}>
              <Input
                ref={refs.baseUrl}
                id="llm-base"
                value={baseUrl}
                onChange={(e) => {
                  setBaseUrl(e.target.value);
                  clear('baseUrl');
                }}
                placeholder="https://api.example.com/v1"
                inputMode="url"
                spellCheck={false}
                autoComplete="off"
                className="font-mono"
              />
            </Field>
          )}

          {info.models.length > 0 && (
            <Field label="Model" htmlFor="llm-model">
              <Select id="llm-model" value={model} onChange={(e) => setModel(e.target.value)}>
                {info.models.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.note ? `${m.label}, ${lowerFirst(m.note)}` : m.label}
                  </option>
                ))}
                <option value={OTHER_MODEL}>Another model</option>
              </Select>
            </Field>
          )}
          {typingModel && (
            <Field label="Model name" htmlFor="llm-custom-model" hint="Exactly as your provider spells it." error={fieldErrors.model}>
              <Input
                ref={refs.model}
                id="llm-custom-model"
                value={customModel}
                onChange={(e) => {
                  setCustomModel(e.target.value);
                  clear('model');
                }}
                placeholder={info.id === 'custom' ? 'llama-3.3-70b-instruct' : info.defaultModel}
                spellCheck={false}
                autoComplete="off"
                className="font-mono"
              />
            </Field>
          )}

          <Field
            label={`${info.name} API key`}
            htmlFor="llm-key"
            hint={keepingKey ? `Leave blank to keep your current key (${current.keyHint}).` : `Taro checks it with ${info.name}, then stores it encrypted.`}
            error={fieldErrors.key}
          >
            <SecretInput
              ref={refs.key}
              id="llm-key"
              value={key}
              onChange={(e) => {
                setKey(e.target.value);
                clear('key');
              }}
              placeholder={info.keyPlaceholder}
            />
          </Field>
          {info.keyUrl && (
            <p className="text-sm text-ink-2">
              No key yet?{' '}
              <a href={info.keyUrl} target="_blank" rel="noreferrer" className={LINK}>
                Create one with {info.name}
              </a>
              .
            </p>
          )}
          {error && <Alert tone="error">{error}</Alert>}
          {removal.confirmNote(
            `Remove the AI model? Taro can't work out what people ask for until someone chooses one again.${
              providers.stt.usesLlmKey ? ' Transcription uses this key too, so it stops as well.' : ''
            }`
          )}
        </DialogBody>
        {/* While the removal question is open, its two buttons are the only choice. */}
        <DialogFooter className={removal.asking ? 'hidden' : undefined}>
          {current.configured && removal.footerButton('Remove model', busy)}
          <Button variant="ghost" className={FOOTER_BUTTON} onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button type="submit" className={FOOTER_BUTTON} pending={saving} disabled={removal.removing}>
            {saving ? `Checking with ${info.name}` : 'Save model'}
          </Button>
        </DialogFooter>
      </form>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------------------------

function SttDialog({
  open,
  providers,
  serverStt,
  onClose,
  onSaved,
}: {
  open: boolean;
  providers: ProviderSettings;
  serverStt: boolean;
  onClose: () => void;
  onSaved: (providers: ProviderSettings) => void;
}) {
  const guard = useSessionGuard();
  // Built-in transcription only when this server hosts it
  const options = STT_PROVIDERS.filter((p) => !p.operatorManaged || serverStt);
  const tiles: ReadonlyArray<Tile<SttProviderId>> = options.map((p) => ({
    id: p.id,
    name: p.name,
    tagline: p.tagline,
    prefix: prefixOf(p.keyPlaceholder),
  }));
  const llmInfo = getLlmProvider(providers.llm.provider);
  const [provider, setProvider] = React.useState<SttProviderId>('groq');
  const [reuse, setReuse] = React.useState(true);
  const [key, setKey] = React.useState('');
  const [keyError, setKeyError] = React.useState('');
  const [saving, setSaving] = React.useState(false);
  const [error, setError] = React.useState('');
  const keyRef = React.useRef<HTMLInputElement>(null);
  const removal = useRemoval({ slot: 'stt', done: 'Transcription removed.', onRemoved: onSaved });

  const info = getSttProvider(provider) ?? STT_PROVIDERS[0];
  // The key's own provider: "Groq", not "Groq Whisper"
  const keyOwner = getLlmProvider(provider)?.name ?? info.name;
  // The AI model's key can run transcription when it's from the same provider
  const canReuse = providers.llm.configured && llmInfo?.sttProvider === provider;
  const keepingKey = providers.stt.provider === provider && providers.stt.configured && !providers.stt.usesLlmKey;
  const usingReuse = canReuse && reuse;

  useOnOpen(open, () => {
    const preferred = providers.stt.provider ?? llmInfo?.sttProvider ?? 'groq';
    setProvider(options.some((o) => o.id === preferred) ? preferred : options[0].id);
    setReuse(providers.stt.configured ? !!providers.stt.usesLlmKey : true);
    setKey('');
    setKeyError('');
    setError('');
    removal.reset();
  });

  const save = async () => {
    if (!info.operatorManaged && !usingReuse && !keepingKey && !key.trim()) {
      setKeyError(`Paste your ${keyOwner} API key.`);
      keyRef.current?.focus();
      return;
    }
    setSaving(true);
    setError('');
    try {
      const { providers: next } = await api.providers.setStt(
        info.operatorManaged
          ? { provider }
          : usingReuse
            ? { provider, useLlmKey: true }
            : { provider, ...(key.trim() ? { apiKey: key.trim() } : {}) }
      );
      showToast('Transcription saved.');
      onSaved(next);
    } catch (e) {
      if (!guard(e)) setError(errorText(e, "Couldn't save transcription."));
      (keyRef.current ?? document.querySelector<HTMLElement>('[data-dialog-panel]'))?.focus();
    } finally {
      setSaving(false);
    }
  };

  const busy = saving || removal.removing;
  const removable = providers.stt.configured && providers.stt.provider !== 'server';

  return (
    <Dialog open={open} onClose={onClose} busy={busy}>
      <form
        noValidate
        onSubmit={(e) => {
          e.preventDefault();
          if (!busy && !removal.asking) save();
        }}
      >
        <DialogHeader>
          <DialogTitle>Transcription</DialogTitle>
          <DialogDescription>Taro turns meeting audio into text as people talk, so it can hear “Hey Taro.”</DialogDescription>
        </DialogHeader>
        <DialogBody className={removal.asking ? 'pb-6 sm:pb-7' : undefined}>
          <ProviderTiles
            label="Transcription provider"
            tiles={tiles}
            value={provider}
            onChange={(id) => {
              setProvider(id);
              setKeyError('');
              setError('');
            }}
            className={tiles.length > 2 ? 'sm:grid-cols-3' : undefined}
          />

          {!info.operatorManaged && canReuse && (
            <label className="flex cursor-pointer items-start gap-3 rounded-control bg-mist px-3.5 py-3">
              <input
                type="checkbox"
                checked={reuse}
                onChange={(e) => setReuse(e.target.checked)}
                className="mt-[3px] h-4 w-4 shrink-0 accent-taro"
              />
              <span className="text-ui text-ink">
                Use my {llmInfo?.name} AI model key
                <span className="block text-meta text-ash">No second key to manage. Usage goes to the same account.</span>
              </span>
            </label>
          )}

          {!info.operatorManaged && !usingReuse && (
            <Field
              label={`${keyOwner} API key`}
              htmlFor="stt-key"
              hint={
                keepingKey ? `Leave blank to keep your current key (${providers.stt.keyHint}).` : `Taro checks it with ${keyOwner}, then stores it encrypted.`
              }
              error={keyError}
            >
              <SecretInput
                ref={keyRef}
                id="stt-key"
                value={key}
                onChange={(e) => {
                  setKey(e.target.value);
                  if (keyError) setKeyError('');
                }}
                placeholder={info.keyPlaceholder}
              />
            </Field>
          )}
          {error && <Alert tone="error">{error}</Alert>}
          {removal.confirmNote("Remove transcription? Taro can't hear requests until someone sets it up again.")}
        </DialogBody>
        {/* While the removal question is open, its two buttons are the only choice. */}
        <DialogFooter className={removal.asking ? 'hidden' : undefined}>
          {removable && removal.footerButton('Remove transcription', busy)}
          <Button variant="ghost" className={FOOTER_BUTTON} onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button type="submit" className={FOOTER_BUTTON} pending={saving} disabled={removal.removing}>
            {saving ? 'Checking' : 'Save'}
          </Button>
        </DialogFooter>
      </form>
    </Dialog>
  );
}
