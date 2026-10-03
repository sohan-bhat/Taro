'use client';

import { useEffect, useState } from 'react';
import { GITHUB_CAPABILITIES, type GithubAccountChoice, type GithubStatus, type SlackStatus } from '@taro/shared';
import { api, ApiError } from '@/lib/api';
import { cn } from '@/lib/utils';
import { GithubMark, SlackMark } from '@/components/brand';
import { Button } from '@/components/ui/button';
import { Dialog, DialogBody, DialogFooter } from '@/components/ui/dialog';
import { Select } from '@/components/ui/select';
import { showToast } from '@/components/ui/toast-store';

function failToast(error: unknown, fallback: string) {
  showToast(error instanceof ApiError ? error.message : fallback, 'error');
}

async function redirectTo(getUrl: () => Promise<{ url: string }>, fallback: string) {
  try {
    const { url } = await getUrl();
    window.location.href = url;
  } catch (error) {
    failToast(error, fallback);
  }
}

type PendingChoices = { token: string; choices: GithubAccountChoice[] };

export function ConnectionsSection({
  slack,
  github,
  canEdit,
  canAddSlack,
  githubChoices,
  onChoicesDone,
  onChanged,
}: {
  slack: SlackStatus;
  github: GithubStatus;
  canEdit: boolean;
  canAddSlack: boolean;
  githubChoices: PendingChoices | null;
  onChoicesDone: () => void;
  onChanged: () => void;
}) {
  const [confirm, setConfirm] = useState<'slack' | 'github' | null>(null);
  const [removing, setRemoving] = useState(false);
  const [showPerms, setShowPerms] = useState(false);
  const [repos, setRepos] = useState<string[]>([]);
  const [repoSaving, setRepoSaving] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);

  useEffect(() => {
    if (!github.connected) {
      setRepos([]);
      return;
    }
    api.github
      .repos()
      .then(({ repos }) => setRepos(repos))
      .catch(() => setRepos([]));
  }, [github.connected, github.accountLogin]);

  const remove = async () => {
    if (!confirm) return;
    setRemoving(true);
    try {
      if (confirm === 'slack') await api.slack.disconnect();
      else await api.github.disconnect();
      showToast(confirm === 'slack' ? 'Slack removed' : 'GitHub disconnected');
      setConfirm(null);
      onChanged();
    } catch (error) {
      failToast(error, 'Could not remove it');
    } finally {
      setRemoving(false);
    }
  };

  const reconnect = async () => {
    setBusy('reconnect');
    try {
      await api.github.reconnect();
      showToast('GitHub reconnected');
      onChanged();
    } catch (error) {
      if (error instanceof ApiError && error.code === 'INSTALL_NEEDED') {
        await redirectTo(() => api.github.installUrl('install'), 'Could not start the GitHub install');
      } else {
        failToast(error, 'Could not reconnect');
      }
    } finally {
      setBusy(null);
    }
  };

  const chooseRepo = async (repo: string) => {
    setRepoSaving(true);
    try {
      await api.github.setRepo(repo);
      showToast(`Issues will go to ${repo}`);
      onChanged();
    } catch (error) {
      failToast(error, 'Could not save the repository');
    } finally {
      setRepoSaving(false);
    }
  };

  const enabled = github.enabledActions ?? [];

  return (
    <>
      <div className="border-y-[1.5px] border-ink">
        <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-4 gap-y-1 border-b border-rule py-3.5 sm:grid-cols-[9rem_minmax(0,1fr)_auto]">
          <span className="flex items-center gap-2 font-bold sm:font-normal">
            <SlackMark className="h-4 w-4 shrink-0" />
            Slack
          </span>
          <span className="col-start-1 min-w-0 sm:col-start-2">
            {slack.connected ? (
              <>in {slack.teamName}</>
            ) : (
              <>
                <span className="sc text-taro">not added</span>
                <span className="block text-sm text-ash">So Taro sees meeting links and posts results.</span>
              </>
            )}
          </span>
          <span className="col-start-2 row-span-2 row-start-1 flex flex-wrap justify-end gap-2 sm:col-start-3 sm:row-span-1">
            {(canEdit || (canAddSlack && !slack.connected)) &&
              (slack.connected ? (
                <Button variant="destructive" size="sm" onClick={() => setConfirm('slack')}>
                  Remove
                </Button>
              ) : (
                <Button
                  size="sm"
                  pending={busy === 'slack'}
                  onClick={async () => {
                    setBusy('slack');
                    await redirectTo(() => api.slack.installUrl(), 'Could not start the Slack install');
                    setBusy(null);
                  }}
                >
                  Add to Slack
                </Button>
              ))}
          </span>
        </div>

        <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-4 gap-y-1 py-3.5 sm:grid-cols-[9rem_minmax(0,1fr)_auto]">
          <span className="flex items-center gap-2 font-bold sm:font-normal">
            <GithubMark className="h-4 w-4 shrink-0 text-ink" />
            GitHub
          </span>
          <span className="col-start-1 min-w-0 sm:col-start-2">
            {!github.configured ? (
              <span className="sc text-ash">not on this server</span>
            ) : github.connected ? (
              <>
                <span className="block truncate">
                  {github.accountLogin}
                  {github.repo && !(repos.length > 1 && canEdit) && <span className="font-mono text-[0.88em] text-ink-2"> {github.repo}</span>}
                </span>
                {repos.length > 0 && (github.needsRepo || repos.length > 1) && canEdit && (
                  <Select
                    aria-label="Repository Taro works in"
                    value={github.repo ?? ''}
                    disabled={repoSaving}
                    onChange={(e) => chooseRepo(e.target.value)}
                    className="mt-2 max-w-xs font-mono text-[0.92rem]"
                  >
                    <option value="" disabled>
                      Choose a repository
                    </option>
                    {repos.map((r) => (
                      <option key={r} value={r}>
                        {r}
                      </option>
                    ))}
                  </Select>
                )}
              </>
            ) : (
              <>
                <span className="sc text-ash">not connected</span>
                <span className="block text-sm text-ash">Optional. Taro files issues as its own bot, never as you.</span>
              </>
            )}
          </span>
          <span className="col-start-2 row-span-2 row-start-1 flex flex-wrap justify-end gap-2 sm:col-start-3 sm:row-span-1">
            {canEdit && github.configured &&
              (github.connected ? (
                <>
                  <Button variant="secondary" size="sm" onClick={() => setShowPerms(true)}>
                    Permissions <span className="font-serif text-ash">{enabled.length}/{GITHUB_CAPABILITIES.length}</span>
                  </Button>
                  <Button variant="destructive" size="sm" onClick={() => setConfirm('github')}>
                    Disconnect
                  </Button>
                </>
              ) : github.reconnectable ? (
                <Button size="sm" pending={busy === 'reconnect'} onClick={reconnect}>
                  Reconnect
                </Button>
              ) : (
                <>
                  <Button
                    size="sm"
                    variant="secondary"
                    pending={busy === 'github'}
                    onClick={async () => {
                      setBusy('github');
                      await redirectTo(() => api.github.installUrl('install'), 'Could not start the GitHub install');
                      setBusy(null);
                    }}
                  >
                    Install
                  </Button>
                  <Button
                    size="sm"
                    variant="link"
                    disabled={busy === 'github'}
                    onClick={async () => {
                      setBusy('github');
                      await redirectTo(() => api.github.installUrl('connect'), 'Could not reach GitHub');
                      setBusy(null);
                    }}
                  >
                    Connect existing
                  </Button>
                </>
              ))}
          </span>
        </div>
      </div>

      <Dialog open={!!confirm} onClose={removing ? () => {} : () => setConfirm(null)} labelledBy="remove-title">
        <DialogBody>
          <h2 id="remove-title" className="font-head text-dialog-title font-bold text-ink">
            {confirm === 'slack' ? 'Remove Taro from Slack?' : 'Disconnect GitHub?'}
          </h2>
          <p className="text-sm leading-relaxed text-ink-2">
            {confirm === 'slack'
              ? "Taro's Slack access is revoked, so it stops seeing meeting links and can't post results. Your meeting history stays. You can add it back any time."
              : 'Taro stops acting on GitHub for this workspace. The app stays installed on GitHub so you can reconnect in one click; uninstall it from your GitHub settings to revoke it completely.'}
          </p>
        </DialogBody>
        <DialogFooter>
          <Button variant="ghost" size="sm" onClick={() => setConfirm(null)} disabled={removing}>
            Cancel
          </Button>
          <Button variant="destructive" size="sm" onClick={remove} disabled={removing}>
            {confirm === 'slack' ? 'Remove from Slack' : 'Disconnect'}
          </Button>
        </DialogFooter>
      </Dialog>

      <PermissionsDialog open={showPerms} enabled={enabled} onClose={() => setShowPerms(false)} onSaved={onChanged} />
      <GithubPickDialog pending={githubChoices} onDone={onChoicesDone} onConnected={onChanged} />
    </>
  );
}

function PermissionsDialog({
  open,
  enabled,
  onClose,
  onSaved,
}: {
  open: boolean;
  enabled: string[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const [actions, setActions] = useState<string[]>(enabled);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (open) setActions(enabled);
  }, [open, enabled]);

  const save = async (next: string[]) => {
    setActions(next);
    setSaving(true);
    try {
      const res = await api.github.setCapabilities(next);
      setActions(res.enabledActions);
      onSaved();
    } catch (error) {
      failToast(error, 'Could not update permissions');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onClose={onClose} labelledBy="perms-title">
      <DialogBody>
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <h2 id="perms-title" className="font-head text-dialog-title font-bold text-ink">
              What Taro may do on GitHub
            </h2>
            <p className="mt-1 text-sm text-ink-2">Anything turned off is refused, even when someone asks for it.</p>
          </div>
        </div>
        <div className="-mx-1 max-h-[52vh] overflow-y-auto px-1">
          {GITHUB_CAPABILITIES.map((cap) => {
            const on = actions.includes(cap.action);
            return (
              <button
                key={cap.action}
                type="button"
                role="switch"
                aria-checked={on}
                onClick={() => save(on ? actions.filter((a) => a !== cap.action) : [...actions, cap.action])}
                className="flex w-full items-center justify-between gap-3 rounded-control px-2 py-2.5 text-left transition hover:bg-poi focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-taro-500"
              >
                <span className="min-w-0">
                  <span className="block text-sm font-medium text-ink">{cap.label}</span>
                  <span className="block truncate text-xs text-ink-2">{cap.description}</span>
                </span>
                <span className={cn('flex h-5 w-9 shrink-0 items-center rounded-full transition-colors', on ? 'bg-taro' : 'bg-field')}>
                  <span className={cn('mx-0.5 h-4 w-4 rounded-full bg-paper shadow-sm transition-transform', on ? 'translate-x-4' : 'translate-x-0')} />
                </span>
              </button>
            );
          })}
        </div>
      </DialogBody>
      <DialogFooter>
        <Button variant="ghost" size="sm" onClick={() => save(GITHUB_CAPABILITIES.map((c) => c.action))} disabled={saving}>
          Allow all
        </Button>
        <Button size="sm" onClick={onClose}>
          Done
        </Button>
      </DialogFooter>
    </Dialog>
  );
}

function GithubPickDialog({
  pending,
  onDone,
  onConnected,
}: {
  pending: PendingChoices | null;
  onDone: () => void;
  onConnected: () => void;
}) {
  const choices = pending?.choices ?? [];
  const [saving, setSaving] = useState<string | null>(null);

  const pick = async (installationId: string) => {
    if (!pending) return;
    setSaving(installationId);
    try {
      await api.github.connect(pending.token, installationId);
      showToast('GitHub connected');
      onConnected();
      onDone();
    } catch (error) {
      failToast(error, 'Could not connect that account');
    } finally {
      setSaving(null);
    }
  };

  return (
    <Dialog open={choices.length > 0} onClose={onDone} labelledBy="pick-title">
      <DialogBody>
        <h2 id="pick-title" className="font-head text-dialog-title font-bold text-ink">
          Which GitHub account should Taro use?
        </h2>
        <p className="text-sm text-ink-2">The Taro app is on more than one account you can reach. Taro only works in repositories you can push to.</p>
        <div className="space-y-2">
          {choices.map((c) => (
            <button
              key={c.installationId}
              type="button"
              onClick={() => pick(c.installationId)}
              disabled={!!saving}
              className="flex w-full items-center justify-between rounded-control border border-rule px-3.5 py-3 text-left hover:border-taro-300 hover:bg-taro-tint focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-taro-500"
            >
              <span className="flex min-w-0 items-center gap-2.5 text-sm font-medium text-ink">
                <GithubMark className="h-4 w-4 shrink-0 text-ink" />
                <span className="truncate">{c.accountLogin}</span>
              </span>
              {saving === c.installationId ? (
                <span className="shrink-0 text-xs text-ash">Connecting…</span>
              ) : (
                <span className="shrink-0 text-xs text-ink-2">
                  {c.repoCount} {c.repoCount === 1 ? 'repo' : 'repos'} you can push to
                </span>
              )}
            </button>
          ))}
        </div>
      </DialogBody>
      <DialogFooter>
        <Button variant="ghost" size="sm" onClick={onDone}>
          Cancel
        </Button>
      </DialogFooter>
    </Dialog>
  );
}
