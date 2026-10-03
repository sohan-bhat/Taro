'use client';

import { useEffect, useState } from 'react';
import type { User, Workspace, WorkspaceRole } from '@taro/shared';
import { api, ApiError } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Dialog, DialogBody, DialogFooter } from '@/components/ui/dialog';
import { Field } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { Separator } from '@/components/ui/separator';
import { Alert } from '@/components/ui/alert';
import { showToast } from '@/components/ui/toast-store';
import { Avatar } from './header';

function MemberIdentity({ user, isMe }: { user: User; isMe: boolean }) {
  return (
    <div className="flex min-w-0 items-center gap-2.5">
      <Avatar user={user} />
      <div className="min-w-0">
        <div className="truncate text-sm font-medium text-ink">
          {user.name}
          {isMe && <span className="font-normal text-ash"> (you)</span>}
        </div>
        {user.email && <div className="truncate text-xs text-ash">{user.email}</div>}
      </div>
    </div>
  );
}

export function MembersDialog({ open, me, onClose }: { open: boolean; me: User; onClose: () => void }) {
  const [members, setMembers] = useState<User[] | null>(null);
  const [saving, setSaving] = useState<string | null>(null);
  const [removing, setRemoving] = useState<User | null>(null);

  useEffect(() => {
    if (!open) return;
    setMembers(null);
    setRemoving(null);
    api.workspace
      .members()
      .then(({ members }) => setMembers(members))
      .catch(() => setMembers([]));
  }, [open]);

  const replace = (member: User) => setMembers((list) => list?.map((m) => (m._id === member._id ? member : m)) ?? null);

  const setRole = async (userId: string, role: WorkspaceRole) => {
    setSaving(userId);
    try {
      const { member } = await api.workspace.setRole(userId, role);
      replace(member);
      showToast(`${member.name} is now ${role === 'owner' ? 'an owner' : role === 'admin' ? 'an admin' : 'a member'}`);
    } catch (e) {
      showToast(e instanceof ApiError ? e.message : 'Could not change the role', 'error');
    } finally {
      setSaving(null);
    }
  };

  const remove = async (user: User) => {
    setSaving(user._id);
    try {
      replace((await api.workspace.removeMember(user._id)).member);
      showToast(`Removed ${user.name}`);
      setRemoving(null);
    } catch (e) {
      showToast(e instanceof ApiError ? e.message : 'Could not remove them', 'error');
    } finally {
      setSaving(null);
    }
  };

  const restore = async (user: User) => {
    setSaving(user._id);
    try {
      replace((await api.workspace.restoreMember(user._id)).member);
      showToast(`Restored ${user.name}`);
    } catch (e) {
      showToast(e instanceof ApiError ? e.message : 'Could not restore them', 'error');
    } finally {
      setSaving(null);
    }
  };

  const isOwner = me.role === 'owner';
  const active = members?.filter((m) => !m.removed) ?? [];
  const removed = members?.filter((m) => m.removed) ?? [];

  return (
    <Dialog open={open} onClose={onClose} labelledBy="members-title">
      <DialogBody>
        <div>
          <h2 id="members-title" className="font-head text-dialog-title font-bold text-ink">
            Members
          </h2>
          <p className="mt-1 text-sm text-ink-2">
            Full members of your Slack workspace can sign in; guests can't. Slack owners and admins get the same role
            here. Owners and admins manage keys and connections.
          </p>
        </div>
        {!members ? (
          <p className="py-6 text-center text-ash">Loading…</p>
        ) : (
          <>
            <ul className="divide-y divide-rule-soft">
              {active.map((m) => (
                <li key={m._id} className="flex items-center justify-between gap-3 py-2.5">
                  <MemberIdentity user={m} isMe={m._id === me._id} />
                  {isOwner && m._id !== me._id ? (
                    <Select
                      aria-label={`Role for ${m.name}`}
                      value={m.role}
                      disabled={saving === m._id}
                      onChange={(e) => {
                        const value = e.target.value;
                        if (value === 'remove') setRemoving(m);
                        else setRole(m._id, value as WorkspaceRole);
                      }}
                      className="w-32"
                    >
                      <option value="owner">Owner</option>
                      <option value="admin">Admin</option>
                      <option value="member">Member</option>
                      <option value="remove">Remove…</option>
                    </Select>
                  ) : (
                    <span className="sc shrink-0 text-[1rem] text-ink-2">{m.role}</span>
                  )}
                </li>
              ))}
            </ul>

            {removing && (
              <Alert variant="destructive" className="py-3">
                <p>
                  Remove <span className="font-semibold">{removing.name}</span>? They're signed out everywhere and can't
                  sign in again until an owner restores them.
                </p>
                <div className="mt-3 flex justify-end gap-2">
                  <Button variant="ghost" size="sm" onClick={() => setRemoving(null)} disabled={saving === removing._id}>
                    Cancel
                  </Button>
                  <Button variant="destructive" size="sm" onClick={() => remove(removing)} disabled={saving === removing._id}>
                    Remove
                  </Button>
                </div>
              </Alert>
            )}

            {removed.length > 0 && (
              <div>
                <h3 className="text-xs font-semibold text-ash">Removed</h3>
                <ul className="mt-1 divide-y divide-rule-soft">
                  {removed.map((m) => (
                    <li key={m._id} className="flex items-center justify-between gap-3 py-2.5 opacity-75">
                      <MemberIdentity user={m} isMe={false} />
                      {isOwner && (
                        <Button variant="outline" size="sm" onClick={() => restore(m)} disabled={saving === m._id}>
                          Restore
                        </Button>
                      )}
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </>
        )}
      </DialogBody>
      <DialogFooter>
        <Button size="sm" onClick={onClose}>
          Done
        </Button>
      </DialogFooter>
    </Dialog>
  );
}

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
  onSaved: (w: Workspace) => void;
  onDeleted: () => void;
}) {
  const [name, setName] = useState(workspace.name);
  const [botName, setBotName] = useState(workspace.botName);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [confirmText, setConfirmText] = useState('');
  const [deleting, setDeleting] = useState(false);

  useEffect(() => {
    if (!open) return;
    setName(workspace.name);
    setBotName(workspace.botName);
    setError('');
    setConfirmText('');
  }, [open, workspace]);

  const save = async () => {
    setSaving(true);
    setError('');
    try {
      const { workspace: updated } = await api.workspace.update({ name: name.trim(), botName: botName.trim() });
      onSaved(updated);
      showToast('Settings saved');
      onClose();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Could not save settings');
    } finally {
      setSaving(false);
    }
  };

  const remove = async () => {
    setDeleting(true);
    try {
      await api.workspace.remove();
      onDeleted();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Could not delete the workspace');
      setDeleting(false);
    }
  };

  const dirty = name.trim() !== workspace.name || botName.trim() !== workspace.botName;

  return (
    <Dialog open={open} onClose={saving || deleting ? () => {} : onClose} labelledBy="settings-title">
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (dirty && name.trim() && botName.trim()) save();
        }}
      >
        <DialogBody>
          <h2 id="settings-title" className="font-head text-dialog-title font-bold text-ink">
            Workspace settings
          </h2>
          <Field label="Workspace name" htmlFor="ws-name">
            <Input id="ws-name" value={name} onChange={(e) => setName(e.target.value)} maxLength={80} />
          </Field>
          <Field label="Name Taro uses in meetings" htmlFor="ws-bot" hint="People still wake it with “Hey Taro.”">
            <Input id="ws-bot" value={botName} onChange={(e) => setBotName(e.target.value)} maxLength={40} />
          </Field>
          {error && <Alert variant="destructive">{error}</Alert>}
          <div className="flex justify-end gap-2">
            <Button type="button" variant="ghost" size="sm" onClick={onClose} disabled={saving}>
              Cancel
            </Button>
            <Button type="submit" size="sm" disabled={!dirty || !name.trim() || !botName.trim() || saving}>
              Save changes
            </Button>
          </div>
        </DialogBody>
      </form>

      {me.role === 'owner' && (
        <>
          <Separator />
          <DialogBody>
            <div>
              <h3 className="font-head font-semibold text-red-700">Delete this workspace</h3>
              <p className="mt-1 text-sm leading-relaxed text-ink-2">
                Removes every stored key, connection, member, and meeting from Taro and revokes Taro&apos;s Slack
                access. This can&apos;t be undone.
              </p>
            </div>
            <Field label={`Type ${workspace.name} to confirm`} htmlFor="ws-delete">
              <Input
                id="ws-delete"
                value={confirmText}
                onChange={(e) => setConfirmText(e.target.value)}
                autoComplete="off"
                spellCheck={false}
                placeholder={workspace.name}
              />
            </Field>
          </DialogBody>
          <DialogFooter>
            <Button
              variant="destructive"
              size="sm"
              disabled={confirmText.trim() !== workspace.name || deleting}
              onClick={remove}
            >
              Delete workspace
            </Button>
          </DialogFooter>
        </>
      )}
    </Dialog>
  );
}
