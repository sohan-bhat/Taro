'use client';

// Members, Workspace settings, and removing Taro from Slack (9.6), plus the confirm dialog the
// GitHub disconnect shares.

import * as React from 'react';
import type { User, Workspace, WorkspaceRole } from '@taro/shared';
import { api } from '@/lib/api';
import { Alert } from '@/components/ui/alert';
import { Avatar } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import { Dialog, DialogBody, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Field } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { Status } from '@/components/ui/status';
import { showToast } from '@/components/ui/toast-store';
import { errorText, useOnOpen, useSessionGuard } from './common';
import { FOOTER_BUTTON } from './styles';

export const ROLE_NAMES: Record<WorkspaceRole, string> = { owner: 'Owner', admin: 'Admin', member: 'Member' };

const firstName = (name: string) => name.trim().split(/\s+/)[0] || name;

/**
 * "Are you sure" for something that can be undone only by setting it up again: a title, what
 * happens, Cancel, and a danger button. Errors show above the buttons.
 */
export function ConfirmDialog({
  open,
  title,
  body,
  confirmLabel,
  pendingLabel,
  fallback,
  onConfirm,
  onClose,
}: {
  open: boolean;
  title: string;
  body: string;
  confirmLabel: string;
  pendingLabel: string;
  // Shown when the failure has no message of its own
  fallback: string;
  onConfirm: () => Promise<void>;
  onClose: () => void;
}) {
  const guard = useSessionGuard();
  const [working, setWorking] = React.useState(false);
  const [error, setError] = React.useState('');
  const confirmRef = React.useRef<HTMLButtonElement>(null);

  useOnOpen(open, () => setError(''));

  const run = async () => {
    setWorking(true);
    setError('');
    try {
      await onConfirm();
    } catch (e) {
      if (!guard(e)) setError(errorText(e, fallback));
      // The button was disabled while working; it takes focus back so trying again is one key away.
      window.setTimeout(() => confirmRef.current?.focus(), 50);
    } finally {
      setWorking(false);
    }
  };

  return (
    <Dialog open={open} onClose={onClose} busy={working}>
      <DialogHeader>
        <DialogTitle>{title}</DialogTitle>
        <DialogDescription>{body}</DialogDescription>
      </DialogHeader>
      {error ? (
        <DialogBody>
          <Alert tone="error">{error}</Alert>
        </DialogBody>
      ) : null}
      <DialogFooter className={error ? undefined : 'pt-6 sm:pt-7'}>
        <Button variant="ghost" className={FOOTER_BUTTON} onClick={onClose} disabled={working}>
          Cancel
        </Button>
        <Button ref={confirmRef} variant="danger" className={FOOTER_BUTTON} onClick={run} pending={working}>
          {working ? pendingLabel : confirmLabel}
        </Button>
      </DialogFooter>
    </Dialog>
  );
}

export function RemoveSlackDialog({ open, onClose, onDone }: { open: boolean; onClose: () => void; onDone: () => void }) {
  return (
    <ConfirmDialog
      open={open}
      onClose={onClose}
      title="Remove Taro from Slack?"
      body="Taro's Slack access is revoked, so it stops seeing meeting links and can't post results. Your meeting history stays. You can add it back any time."
      confirmLabel="Remove from Slack"
      pendingLabel="Removing"
      fallback="Couldn't remove Taro from Slack."
      onConfirm={async () => {
        await api.slack.disconnect();
        showToast('Slack removed.');
        onDone();
      }}
    />
  );
}

// ---------------------------------------------------------------------------------------------

function Identity({ user, isMe }: { user: User; isMe: boolean }) {
  return (
    <span className="flex min-w-0 items-center gap-3">
      <Avatar name={user.name} src={user.avatarUrl} />
      <span className="min-w-0">
        <span className="block truncate text-ui font-semibold text-ink">
          {user.name}
          {isMe && <span className="font-normal text-ash"> (you)</span>}
        </span>
        {user.email && <span className="block truncate text-meta text-ash">{user.email}</span>}
      </span>
    </span>
  );
}

const roleNoun = (role: WorkspaceRole) => (role === 'owner' ? 'an owner' : role === 'admin' ? 'an admin' : 'a member');

/** Everyone who has signed in. Owners change roles, remove people, and restore them; everyone else reads the list. */
/** Who can sign in to this workspace, and who decides roles. */
function membersNote(workspace: Workspace): string {
  if (workspace.personal) {
    const account = workspace.signInWith === 'microsoft' ? 'Microsoft' : 'Google';
    return `This workspace belongs to your personal ${account} account, so only you can sign in to it.`;
  }
  switch (workspace.signInWith) {
    case 'google':
      return `Anyone who signs in with a Google account at ${workspace.domain ?? 'your company'} joins as a member. Owners change roles here, and owners and admins manage keys and connections.`;
    case 'microsoft':
      return 'Anyone who signs in with a work or school account from your organization joins as a member. Owners change roles here, and owners and admins manage keys and connections.';
    default:
      return "Full members of your Slack workspace can sign in. Guests can't. Slack owners and admins get the same role here, and they manage keys and connections.";
  }
}

export function MembersDialog({ open, me, workspace, onClose }: { open: boolean; me: User; workspace: Workspace; onClose: () => void }) {
  const guard = useSessionGuard();
  const [members, setMembers] = React.useState<User[] | null>(null);
  const [loadError, setLoadError] = React.useState('');
  const [saving, setSaving] = React.useState<string | null>(null);
  const [removing, setRemoving] = React.useState<User | null>(null);
  const [error, setError] = React.useState('');
  const cancelRef = React.useRef<HTMLButtonElement>(null);

  useOnOpen(open, () => {
    setMembers(null);
    setLoadError('');
    setRemoving(null);
    setError('');
    api.workspace
      .members()
      .then(({ members }) => setMembers(members))
      .catch((e) => {
        if (!guard(e)) setLoadError(errorText(e, "Couldn't load members."));
      });
  });

  // The confirmation takes focus on its safe choice; closing it puts focus back on that person's role.
  React.useEffect(() => {
    if (removing) cancelRef.current?.focus();
  }, [removing]);
  const keep = (user: User) => {
    setRemoving(null);
    window.setTimeout(() => document.getElementById(`role-${user._id}`)?.focus(), 0);
  };

  const replace = (member: User | undefined) => {
    if (member?._id) setMembers((list) => list?.map((m) => (m._id === member._id ? member : m)) ?? null);
  };

  const run = async (user: User, action: () => Promise<void>, fallback: string) => {
    setSaving(user._id);
    setError('');
    try {
      await action();
    } catch (e) {
      if (!guard(e)) setError(errorText(e, fallback));
      // Whatever was pressed was disabled meanwhile; their role, or the dialog, takes focus back.
      refocus(`role-${user._id}`);
    } finally {
      setSaving(null);
    }
  };

  const setRole = (user: User, role: WorkspaceRole) =>
    run(
      user,
      async () => {
        const { member } = await api.workspace.setRole(user._id, role);
        replace(member);
        showToast(`${user.name} is now ${roleNoun(member?.role ?? role)}.`);
        refocus(`role-${user._id}`);
      },
      "Couldn't change the role."
    );

  // The row a person was on moves between groups, so focus goes somewhere that stays: their role
  // after a restore, the dialog itself after a removal (never Restore, which a second Enter would press).
  const focusNext = React.useRef<string | null>(null);
  const refocus = (id?: string) => {
    focusNext.current = id ?? 'panel';
  };
  React.useEffect(() => {
    const target = focusNext.current;
    if (!target || saving) return;
    focusNext.current = null;
    const el = target === 'panel' ? null : document.getElementById(target);
    (el ?? document.querySelector<HTMLElement>('[data-dialog-panel]'))?.focus();
  });

  const remove = (user: User) =>
    run(
      user,
      async () => {
        replace((await api.workspace.removeMember(user._id)).member);
        setRemoving(null);
        showToast(`Removed ${user.name}.`);
        refocus();
      },
      "Couldn't remove them."
    );

  const restore = (user: User) =>
    run(
      user,
      async () => {
        replace((await api.workspace.restoreMember(user._id)).member);
        showToast(`Restored ${user.name}.`);
        refocus(`role-${user._id}`);
      },
      "Couldn't restore them."
    );

  const isOwner = me.role === 'owner';
  const active = members?.filter((m) => !m.removed) ?? [];
  const removed = members?.filter((m) => m.removed) ?? [];

  return (
    <Dialog open={open} onClose={onClose}>
      <DialogHeader>
        <DialogTitle>Members</DialogTitle>
        <DialogDescription>{membersNote(workspace)}</DialogDescription>
      </DialogHeader>
      <DialogBody>
        {loadError ? (
          <Alert tone="error">{loadError}</Alert>
        ) : !members ? (
          <p className="text-meta text-ash">Loading members</p>
        ) : (
          <>
            <ul className="list-none">
              {active.map((m) => {
                const mine = m._id === me._id;
                return (
                  <li key={m._id} className="border-b border-rule-soft py-2.5">
                    <div className="flex items-center justify-between gap-3">
                      <Identity user={m} isMe={mine} />
                      {isOwner && !mine ? (
                        <Select
                          id={`role-${m._id}`}
                          aria-label={`Role for ${m.name}`}
                          value={m.role}
                          disabled={saving === m._id}
                          onChange={(e) => {
                            const value = e.target.value;
                            // "Remove…" asks first; the select keeps showing the current role.
                            if (value === 'remove') setRemoving(m);
                            else if (value !== m.role) setRole(m, value as WorkspaceRole);
                          }}
                          wrapperClassName="w-[118px] shrink-0"
                        >
                          <option value="owner">Owner</option>
                          <option value="admin">Admin</option>
                          <option value="member">Member</option>
                          <option value="remove">Remove…</option>
                        </Select>
                      ) : (
                        <Status tone="neutral" className="shrink-0">
                          {ROLE_NAMES[m.role]}
                        </Status>
                      )}
                    </div>
                    {removing?._id === m._id && (
                      <Alert tone="error" className="mt-3">
                        <p>
                          Remove {firstName(m.name)}? They&apos;re signed out everywhere and can&apos;t sign in again until an owner restores
                          them.
                        </p>
                        <div className="mt-3 flex justify-end gap-2">
                          <Button ref={cancelRef} variant="ghost" size="sm" onClick={() => keep(m)} disabled={saving === m._id}>
                            Cancel
                          </Button>
                          <Button variant="danger" size="sm" onClick={() => remove(m)} pending={saving === m._id}>
                            {saving === m._id ? 'Removing' : 'Remove'}
                          </Button>
                        </div>
                      </Alert>
                    )}
                  </li>
                );
              })}
            </ul>

            {removed.length > 0 && (
              <div>
                <h3 className="mb-1 text-meta font-semibold text-ash">Removed</h3>
                <ul className="list-none">
                  {removed.map((m) => (
                    <li key={m._id} className="flex items-center justify-between gap-3 border-b border-rule-soft py-2.5">
                      <Identity user={m} isMe={false} />
                      {isOwner && (
                        <Button variant="secondary" size="sm" className="shrink-0" onClick={() => restore(m)} pending={saving === m._id}>
                          {saving === m._id ? 'Restoring' : 'Restore'}
                        </Button>
                      )}
                    </li>
                  ))}
                </ul>
              </div>
            )}
            {error && <Alert tone="error">{error}</Alert>}
          </>
        )}
      </DialogBody>
      <DialogFooter>
        <Button className={FOOTER_BUTTON} onClick={onClose}>
          Done
        </Button>
      </DialogFooter>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------------------------

/** The workspace's name and Taro's meeting name; owners also get deleting the workspace, behind a typed confirmation. */
export function SettingsDialog({
  open,
  workspace,
  me,
  onClose,
  onSaved,
  onDeleted,
}: {
  open: boolean;
  workspace: Workspace;
  me: User;
  onClose: () => void;
  onSaved: (workspace: Workspace) => void;
  // The workspace is gone; the caller signs out and says so
  onDeleted: (name: string) => void;
}) {
  const guard = useSessionGuard();
  const [name, setName] = React.useState(workspace.name);
  const [botName, setBotName] = React.useState(workspace.botName);
  const [fieldErrors, setFieldErrors] = React.useState<{ name?: string; botName?: string }>({});
  const [saving, setSaving] = React.useState(false);
  const [error, setError] = React.useState('');
  const [confirmText, setConfirmText] = React.useState('');
  const [deleting, setDeleting] = React.useState(false);
  const [deleteError, setDeleteError] = React.useState('');
  const nameRef = React.useRef<HTMLInputElement>(null);
  const botRef = React.useRef<HTMLInputElement>(null);
  const deleteRef = React.useRef<HTMLInputElement>(null);

  useOnOpen(open, () => {
    setName(workspace.name);
    setBotName(workspace.botName);
    setFieldErrors({});
    setError('');
    setConfirmText('');
    setDeleteError('');
  });

  const save = async () => {
    const nextName = name.trim();
    const nextBot = botName.trim();
    const problems: typeof fieldErrors = {};
    if (!nextName) problems.name = 'Enter a name for the workspace.';
    if (!nextBot) problems.botName = 'Enter the name Taro uses in meetings.';
    setFieldErrors(problems);
    if (problems.name) return nameRef.current?.focus();
    if (problems.botName) return botRef.current?.focus();
    // Nothing changed, so there is nothing to save.
    if (nextName === workspace.name && nextBot === workspace.botName) return onClose();
    setSaving(true);
    setError('');
    try {
      const { workspace: updated } = await api.workspace.update({ name: nextName, botName: nextBot });
      onSaved(updated);
      showToast('Settings saved.');
      onClose();
    } catch (e) {
      if (!guard(e)) setError(errorText(e, "Couldn't save the settings."));
      nameRef.current?.focus();
    } finally {
      setSaving(false);
    }
  };

  const remove = async () => {
    setDeleting(true);
    setDeleteError('');
    try {
      await api.workspace.remove();
      onDeleted(workspace.name);
    } catch (e) {
      if (!guard(e)) setDeleteError(errorText(e, "Couldn't delete the workspace."));
      setDeleting(false);
      deleteRef.current?.focus();
    }
  };

  const busy = saving || deleting;
  return (
    <Dialog open={open} onClose={onClose} busy={busy}>
      <form
        noValidate
        onSubmit={(e) => {
          e.preventDefault();
          if (!busy) save();
        }}
      >
        <DialogHeader>
          <DialogTitle>Workspace settings</DialogTitle>
        </DialogHeader>
        <DialogBody>
          <Field label="Workspace name" htmlFor="ws-name" error={fieldErrors.name}>
            <Input
              ref={nameRef}
              id="ws-name"
              value={name}
              maxLength={80}
              autoComplete="off"
              onChange={(e) => {
                setName(e.target.value);
                if (fieldErrors.name) setFieldErrors((f) => ({ ...f, name: undefined }));
              }}
            />
          </Field>
          <Field label="Name Taro uses in meetings" htmlFor="ws-bot" hint="People still wake it with “Hey Taro.”" error={fieldErrors.botName}>
            <Input
              ref={botRef}
              id="ws-bot"
              value={botName}
              maxLength={40}
              autoComplete="off"
              onChange={(e) => {
                setBotName(e.target.value);
                if (fieldErrors.botName) setFieldErrors((f) => ({ ...f, botName: undefined }));
              }}
            />
          </Field>
          {error && <Alert tone="error">{error}</Alert>}
        </DialogBody>
        <DialogFooter>
          <Button variant="ghost" className={FOOTER_BUTTON} onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button type="submit" className={FOOTER_BUTTON} pending={saving} disabled={deleting}>
            {saving ? 'Saving' : 'Save changes'}
          </Button>
        </DialogFooter>
      </form>

      {me.role === 'owner' && (
        <div className="border-t border-rule px-5 py-6 sm:px-7">
          <h3 className="text-panel-title font-bold text-beet">Delete this workspace</h3>
          <p className="mt-2 text-ui leading-[1.55] text-ink-2">
            Deleting removes your keys, connections, members, and meeting history from Taro and revokes Taro&apos;s Slack access.
            This can&apos;t be undone.
          </p>
          <div className="mt-4 space-y-3">
            <Field label={`Type ${workspace.name} to confirm`} htmlFor="ws-delete">
              <Input
                ref={deleteRef}
                id="ws-delete"
                value={confirmText}
                onChange={(e) => setConfirmText(e.target.value)}
                autoComplete="off"
                spellCheck={false}
              />
            </Field>
            {deleteError && <Alert tone="error">{deleteError}</Alert>}
            <Button
              variant="danger"
              className={FOOTER_BUTTON}
              disabled={confirmText.trim() !== workspace.name || saving}
              pending={deleting}
              onClick={remove}
            >
              {deleting ? 'Deleting' : 'Delete workspace'}
            </Button>
          </div>
        </div>
      )}
    </Dialog>
  );
}
