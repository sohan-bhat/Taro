'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import type { User, Workspace } from '@taro/shared';
import { cn } from '@/lib/utils';
import { Wordmark } from '@/components/brand';
import { Separator } from '@/components/ui/separator';

export function Avatar({ user, className }: { user: User; className?: string }) {
  const initials = user.name
    .split(/\s+/)
    .map((w) => w[0])
    .join('')
    .slice(0, 2)
    .toUpperCase();
  return user.avatarUrl ? (
    // eslint-disable-next-line @next/next/no-img-element
    <img src={user.avatarUrl} alt="" className={cn('h-7 w-7 rounded-full object-cover', className)} referrerPolicy="no-referrer" />
  ) : (
    <span className={cn('grid h-7 w-7 place-items-center rounded-full bg-taro-100 text-xs font-semibold text-taro-700', className)}>
      {initials}
    </span>
  );
}

const ROLE_LABEL = { owner: 'Owner', admin: 'Admin', member: 'Member' } as const;

export function DashboardHeader({
  workspace,
  me,
  onMembers,
  onSettings,
  onSignOut,
}: {
  workspace: Workspace;
  me: User;
  onMembers: () => void;
  onSettings: () => void;
  onSignOut: () => void;
}) {
  const [open, setOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onClick = (e: MouseEvent) => {
      if (!menuRef.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('mousedown', onClick);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onClick);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const item =
    'block w-full rounded-control px-3 py-2 text-left text-sm text-ink-2 hover:bg-poi focus-visible:bg-poi focus-visible:outline-none';

  return (
    <header>
      <div className="mx-auto flex max-w-page items-center justify-between gap-3 px-5 py-4 sm:px-2 sm:py-6">
        <Link href="/" className="shrink-0 rounded-sm">
          <Wordmark />
        </Link>

        <div ref={menuRef} className="relative">
          <button
            type="button"
            onClick={() => setOpen((o) => !o)}
            aria-haspopup="menu"
            aria-expanded={open}
            className="flex items-center gap-2 rounded-control py-1 pl-1 pr-2.5 text-ink-2 hover:bg-paper/70"
          >
            <Avatar user={me} />
            <span className="hidden max-w-[10rem] truncate sm:inline">{me.name}</span>
            <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden className="h-3.5 w-3.5 text-ash">
              <path d="M6 8l4 4 4-4" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </button>
          {open && (
            <div role="menu" className="absolute right-0 z-40 mt-2 w-60 rounded-menu border border-rule bg-paper p-1.5 shadow-menu">
              <div className="px-3 py-2">
                <div className="truncate text-sm font-medium text-ink">{me.name}</div>
                <div className="truncate text-xs text-ash">
                  {ROLE_LABEL[me.role]} · {workspace.name}
                </div>
              </div>
              <Separator className="my-1" />
              <button role="menuitem" className={item} onClick={() => (setOpen(false), onMembers())}>
                Members
              </button>
              {me.role !== 'member' && (
                <button role="menuitem" className={item} onClick={() => (setOpen(false), onSettings())}>
                  Workspace settings
                </button>
              )}
              <Link role="menuitem" href="/demo" className={item} onClick={() => setOpen(false)}>
                View the demo workspace
              </Link>
              <Separator className="my-1" />
              <button role="menuitem" className={item} onClick={() => (setOpen(false), onSignOut())}>
                Sign out
              </button>
            </div>
          )}
        </div>
      </div>
    </header>
  );
}
