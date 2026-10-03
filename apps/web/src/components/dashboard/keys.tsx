'use client';

import { useEffect, useState } from 'react';
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
import { api, ApiError } from '@/lib/api';
import { timeAgo } from '@/lib/format';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Dialog, DialogBody, DialogFooter } from '@/components/ui/dialog';
import { Field } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { SecretInput } from '@/components/ui/secret-input';
import { Select } from '@/components/ui/select';
import { Alert } from '@/components/ui/alert';
import { showToast } from '@/components/ui/toast-store';

export type KeySlot = 'meetingBot' | 'llm' | 'stt';

function SlotRow({
  label,
  ready,
  title,
  meta,
  action,
  canEdit,
  onEdit,
}: {
  label: string;
  ready: boolean;
  title: string;
  meta?: string;
  action: string;
  canEdit: boolean;
  onEdit: () => void;
}) {
  return (
    <li className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-4 gap-y-0.5 border-b border-rule py-3 last:border-b-0 sm:grid-cols-[9rem_minmax(0,1fr)_auto]">
      <span className="font-bold sm:font-normal">{label}</span>
      <span className="col-start-1 min-w-0 sm:col-start-2">
        {ready ? <span className="block truncate">{title}</span> : <span className="sc text-taro">not set</span>}
        {meta && <span className="block truncate font-mono text-[0.84rem] text-ash">{meta}</span>}
      </span>
      <span className="col-start-2 row-span-2 row-start-1 sm:col-start-3 sm:row-span-1">
        {canEdit && (
          <Button variant={ready ? 'secondary' : 'primary'} size="sm" onClick={onEdit}>
            {action}
          </Button>
        )}
      </span>
    </li>
  );
}

export function KeysSection({
  providers,
  canEdit,
  serverStt,
  editing,
  setEditing,
  onUpdated,
}: {
  providers: ProviderSettings;
  canEdit: boolean;
  serverStt: boolean;
  // Controlled by the page so the setup checklist can open these dialogs too
  editing: KeySlot | null;
  setEditing: (slot: KeySlot | null) => void;
  onUpdated: (providers: ProviderSettings) => void;
}) {
  const llmInfo = getLlmProvider(providers.llm.provider);
  const llmModel = llmInfo?.models.find((m) => m.id === providers.llm.model)?.label ?? providers.llm.model;
  const sttInfo = getSttProvider(providers.stt.provider);
  const checked = (iso?: string) => (iso ? `, checked ${timeAgo(iso)}` : '');

  return (
    <>
      <div className="border-y-[1.5px] border-ink">
        <div aria-hidden className="hidden grid-cols-[9rem_minmax(0,1fr)_auto] gap-x-4 border-b border-ink py-1.5 font-bold sm:grid">
          <span>Part</span>
          <span>Provider and key</span>
          <span />
        </div>
        <ul>
          <SlotRow
            label="Meeting bot"
            ready={providers.meetingBot.configured}
            title="MeetingBaas"
            meta={providers.meetingBot.keyHint ? `${providers.meetingBot.keyHint}${checked(providers.meetingBot.validatedAt)}` : undefined}
            action={providers.meetingBot.configured ? 'Replace key' : 'Add key'}
            canEdit={canEdit}
            onEdit={() => setEditing('meetingBot')}
          />
          <SlotRow
            label="AI model"
            ready={providers.llm.configured}
            title={llmInfo ? `${llmInfo.name}, ${llmModel}` : 'Not set'}
            meta={providers.llm.keyHint ? `${providers.llm.keyHint}${checked(providers.llm.validatedAt)}` : undefined}
            action={providers.llm.configured ? 'Change' : 'Choose'}
            canEdit={canEdit}
            onEdit={() => setEditing('llm')}
          />
          <SlotRow
            label="Transcription"
            ready={providers.stt.configured}
            title={sttInfo ? `${sttInfo.name}${providers.stt.usesLlmKey ? ', on the AI model’s key' : ''}` : 'Not set'}
            meta={
              providers.stt.provider === 'server'
                ? 'hosted by this server'
                : providers.stt.keyHint && !providers.stt.usesLlmKey
                  ? `${providers.stt.keyHint}${checked(providers.stt.validatedAt)}`
                  : undefined
            }
            action={providers.stt.configured ? 'Change' : 'Set up'}
            canEdit={canEdit}
            onEdit={() => setEditing('stt')}
          />
        </ul>
      </div>
      {!canEdit && <p className="mt-2 text-sm text-ash">Owners and admins change keys.</p>}

      <MeetingBotDialog
        open={editing === 'meetingBot'}
        configured={providers.meetingBot.configured}
        onClose={() => setEditing(null)}
        onSaved={(p) => {
          onUpdated(p);
          setEditing(null);
          showToast('Meeting bot connected');
        }}
      />
      <LlmDialog
        open={editing === 'llm'}
        current={providers.llm}
        onClose={() => setEditing(null)}
        onSaved={(p) => {
          onUpdated(p);
          setEditing(null);
          showToast('AI model saved');
        }}
      />
      <SttDialog
        open={editing === 'stt'}
        providers={providers}
        serverStt={serverStt}
        onClose={() => setEditing(null)}
        onSaved={(p) => {
          onUpdated(p);
          setEditing(null);
          showToast('Transcription saved');
        }}
      />
    </>
  );
}

function errorText(error: unknown): string {
  return error instanceof ApiError ? error.message : 'Something went wrong. Try again.';
}

function MeetingBotDialog({
  open,
  configured,
  onClose,
  onSaved,
}: {
  open: boolean;
  configured: boolean;
  onClose: () => void;
  onSaved: (p: ProviderSettings) => void;
}) {
  const [key, setKey] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (open) {
      setKey('');
      setError('');
    }
  }, [open]);

  const save = async () => {
    setSaving(true);
    setError('');
    try {
      const { providers } = await api.providers.setMeetingBot(key.trim());
      onSaved(providers);
    } catch (e) {
      setError(errorText(e));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onClose={saving ? () => {} : onClose} labelledBy="mb-title">
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (key.trim()) save();
        }}
      >
        <DialogBody>
          <div>
            <h2 id="mb-title" className="font-head text-dialog-title font-bold text-ink">
              {configured ? 'Replace your MeetingBaas key' : 'Connect your meeting bot'}
            </h2>
            <p className="mt-1.5 text-sm leading-relaxed text-ink-2">
              Taro uses your MeetingBaas account to send a bot into each call. Create an API key in your{' '}
              <a href={MEETING_BOT_PROVIDER.keyUrl} target="_blank" rel="noreferrer" className="text-taro-600 underline decoration-taro-300 underline-offset-2">
                MeetingBaas dashboard
              </a>
              , then paste it here.
            </p>
          </div>
          <Field label="MeetingBaas API key" htmlFor="mb-key" hint="Taro checks it with MeetingBaas, then stores it encrypted.">
            <SecretInput
              id="mb-key"
              value={key}
              onChange={(e) => setKey(e.target.value)}
              placeholder={MEETING_BOT_PROVIDER.keyPlaceholder}
              autoFocus
            />
          </Field>
          {error && <Alert variant="destructive">{error}</Alert>}
        </DialogBody>
        <DialogFooter>
          <Button type="button" variant="ghost" size="sm" onClick={onClose} disabled={saving}>
            Cancel
          </Button>
          <Button type="submit" size="sm" disabled={!key.trim() || saving}>
            {saving ? 'Checking key' : 'Save key'}
          </Button>
        </DialogFooter>
      </form>
    </Dialog>
  );
}

const OTHER_MODEL = '__other__';

function LlmDialog({
  open,
  current,
  onClose,
  onSaved,
}: {
  open: boolean;
  current: ProviderSettings['llm'];
  onClose: () => void;
  onSaved: (p: ProviderSettings) => void;
}) {
  const [provider, setProvider] = useState<LlmProviderId>('anthropic');
  const [model, setModel] = useState('');
  const [customModel, setCustomModel] = useState('');
  const [baseUrl, setBaseUrl] = useState('');
  const [key, setKey] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const info = getLlmProvider(provider)!;
  const keepingKey = current.configured && current.provider === provider;

  useEffect(() => {
    if (!open) return;
    const start = (current.provider as LlmProviderId) ?? 'anthropic';
    const startInfo = getLlmProvider(start)!;
    const known = startInfo.models.some((m) => m.id === current.model);
    setProvider(start);
    setModel(current.model && !known ? OTHER_MODEL : current.model || startInfo.defaultModel);
    setCustomModel(current.model && !known ? current.model : '');
    setBaseUrl(current.baseUrl ?? '');
    setKey('');
    setError('');
  }, [open, current]);

  const choose = (id: LlmProviderId) => {
    const next = getLlmProvider(id)!;
    setProvider(id);
    setModel(next.models.length ? next.defaultModel : OTHER_MODEL);
    setCustomModel('');
    setError('');
  };

  const resolvedModel = model === OTHER_MODEL || info.models.length === 0 ? customModel.trim() : model;
  const canSave = (keepingKey || key.trim()) && resolvedModel && (!info.needsBaseUrl || baseUrl.trim());

  const save = async () => {
    setSaving(true);
    setError('');
    try {
      const { providers } = await api.providers.setLlm({
        provider,
        model: resolvedModel,
        ...(key.trim() ? { apiKey: key.trim() } : {}),
        ...(info.needsBaseUrl ? { baseUrl: baseUrl.trim() } : {}),
      });
      onSaved(providers);
    } catch (e) {
      setError(errorText(e));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onClose={saving ? () => {} : onClose} labelledBy="llm-title" size="lg">
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (canSave) save();
        }}
      >
        <DialogBody>
          <div>
            <h2 id="llm-title" className="font-head text-dialog-title font-bold text-ink">
              Choose your AI model
            </h2>
            <p className="mt-1.5 text-sm leading-relaxed text-ink-2">
              Taro sends each spoken request to this model to work out what to do. Usage is billed to your account.
            </p>
          </div>

          <div role="radiogroup" aria-label="AI provider" className="grid grid-cols-2 gap-2 sm:grid-cols-3">
            {LLM_PROVIDERS.map((p) => (
              <button
                key={p.id}
                type="button"
                role="radio"
                aria-checked={provider === p.id}
                onClick={() => choose(p.id)}
                className={cn(
                  'rounded-control border px-3 py-2.5 text-left transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-taro-500',
                  provider === p.id
                    ? 'border-taro-400 bg-taro-tint shadow-[0_2px_0_theme(colors.taro.300)]'
                    : 'border-rule bg-paper hover:border-field'
                )}
              >
                <span className="block text-sm font-semibold text-ink">{p.name}</span>
                <span className="block truncate text-sm text-ink-2">{p.tagline}</span>
              </button>
            ))}
          </div>

          {info.needsBaseUrl && (
            <Field label="Base URL" htmlFor="llm-base" hint="An OpenAI-compatible API, for example https://api.together.xyz/v1">
              <Input
                id="llm-base"
                value={baseUrl}
                onChange={(e) => setBaseUrl(e.target.value)}
                placeholder="https://api.example.com/v1"
                spellCheck={false}
                autoComplete="off"
              />
            </Field>
          )}

          {info.models.length > 0 && (
            <Field label="Model" htmlFor="llm-model">
              <Select id="llm-model" value={model} onChange={(e) => setModel(e.target.value)}>
                {info.models.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.label}
                    {m.note ? `  (${m.note})` : ''}
                  </option>
                ))}
                <option value={OTHER_MODEL}>Another model</option>
              </Select>
            </Field>
          )}
          {(model === OTHER_MODEL || info.models.length === 0) && (
            <Field label="Model name" htmlFor="llm-custom-model" hint="Exactly as your provider spells it.">
              <Input
                id="llm-custom-model"
                value={customModel}
                onChange={(e) => setCustomModel(e.target.value)}
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
            hint={keepingKey ? `Leave blank to keep your current key (${current.keyHint}).` : 'Taro checks it with the provider, then stores it encrypted.'}
          >
            <SecretInput id="llm-key" value={key} onChange={(e) => setKey(e.target.value)} placeholder={info.keyPlaceholder} />
          </Field>
          {info.keyUrl && (
            <p className="-mt-2 text-xs text-ink-2">
              No key yet?{' '}
              <a href={info.keyUrl} target="_blank" rel="noreferrer" className="text-taro-600 underline decoration-taro-300 underline-offset-2">
                Create one with {info.name}
              </a>
              .
            </p>
          )}
          {error && <Alert variant="destructive">{error}</Alert>}
        </DialogBody>
        <DialogFooter>
          <Button type="button" variant="ghost" size="sm" onClick={onClose} disabled={saving}>
            Cancel
          </Button>
          <Button type="submit" size="sm" disabled={!canSave || saving}>
            {saving ? 'Checking' : 'Save model'}
          </Button>
        </DialogFooter>
      </form>
    </Dialog>
  );
}

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
  onSaved: (p: ProviderSettings) => void;
}) {
  const options = STT_PROVIDERS.filter((p) => !p.operatorManaged || serverStt);
  const llmInfo = getLlmProvider(providers.llm.provider);
  const [provider, setProvider] = useState<SttProviderId>('groq');
  const [reuse, setReuse] = useState(true);
  const [key, setKey] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const info = getSttProvider(provider)!;
  // The AI model's key can run transcription when it's from the same provider
  const canReuse = providers.llm.configured && llmInfo?.sttProvider === provider;
  const keepingKey = providers.stt.provider === provider && providers.stt.configured && !providers.stt.usesLlmKey;

  useEffect(() => {
    if (!open) return;
    const start = (providers.stt.provider as SttProviderId) ?? llmInfo?.sttProvider ?? 'groq';
    setProvider(start);
    setReuse(providers.stt.configured ? !!providers.stt.usesLlmKey : true);
    setKey('');
    setError('');
  }, [open, providers, llmInfo]);

  const usingReuse = canReuse && reuse;
  const canSave = info.operatorManaged || usingReuse || keepingKey || key.trim().length > 0;

  const save = async () => {
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
      onSaved(next);
    } catch (e) {
      setError(errorText(e));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onClose={saving ? () => {} : onClose} labelledBy="stt-title">
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (canSave) save();
        }}
      >
        <DialogBody>
          <div>
            <h2 id="stt-title" className="font-head text-dialog-title font-bold text-ink">
              Transcription
            </h2>
            <p className="mt-1.5 text-sm leading-relaxed text-ink-2">
              Taro turns meeting audio into text as people talk, so it can hear “Hey Taro.”
            </p>
          </div>
          <div role="radiogroup" aria-label="Transcription provider" className="grid gap-2 sm:grid-cols-2">
            {options.map((p) => (
              <button
                key={p.id}
                type="button"
                role="radio"
                aria-checked={provider === p.id}
                onClick={() => {
                  setProvider(p.id);
                  setError('');
                }}
                className={cn(
                  'rounded-control border px-3 py-2.5 text-left transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-taro-500',
                  provider === p.id
                    ? 'border-taro-400 bg-taro-tint shadow-[0_2px_0_theme(colors.taro.300)]'
                    : 'border-rule bg-paper hover:border-field'
                )}
              >
                <span className="block text-sm font-semibold text-ink">{p.name}</span>
                <span className="block text-sm leading-snug text-ink-2">{p.tagline}</span>
              </button>
            ))}
          </div>

          {!info.operatorManaged && canReuse && (
            <label className="flex cursor-pointer items-start gap-3 rounded-control border border-rule bg-poi px-3.5 py-3">
              <input
                type="checkbox"
                checked={reuse}
                onChange={(e) => setReuse(e.target.checked)}
                className="mt-0.5 h-4 w-4 accent-taro-600"
              />
              <span className="text-sm text-ink-2">
                Use my {llmInfo?.name} AI model key
                <span className="block text-xs text-ink-2">No second key to manage. Usage goes to the same account.</span>
              </span>
            </label>
          )}

          {!info.operatorManaged && !usingReuse && (
            <Field
              label={`${info.name} API key`}
              htmlFor="stt-key"
              hint={keepingKey ? `Leave blank to keep your current key (${providers.stt.keyHint}).` : 'Taro checks it, then stores it encrypted.'}
            >
              <SecretInput id="stt-key" value={key} onChange={(e) => setKey(e.target.value)} placeholder={info.keyPlaceholder} />
            </Field>
          )}
          {error && <Alert variant="destructive">{error}</Alert>}
        </DialogBody>
        <DialogFooter>
          <Button type="button" variant="ghost" size="sm" onClick={onClose} disabled={saving}>
            Cancel
          </Button>
          <Button type="submit" size="sm" disabled={!canSave || saving}>
            {saving ? 'Checking' : 'Save'}
          </Button>
        </DialogFooter>
      </form>
    </Dialog>
  );
}
