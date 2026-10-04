'use client';

// The dashboard shell's header (9.3): the wordmark, the workspace, the Meetings and Setup tabs,
// and the account menu. Below 768px the tabs move to their own sticky row under it.

import * as React from 'react';
import Link from 'next/link';
import type { User, Workspace } from '@taro/shared';
import { Wordmark } from '@/components/brand';
import { Avatar } from '@/components/ui/avatar';
import { Menu, MenuHeader, MenuItem, MenuLink, MenuPopover, MenuSeparator, MenuTrigger } from '@/components/ui/menu';
import { ViewTabs, type ViewTab } from '@/components/ui/tabs';
import { ROLE_NAMES } from './workspace-dialogs';

/** The sticky Paper bar with the wordmark. While the workspace loads it holds nothing else. */
export function HeaderBar({ children }: { children?: React.ReactNode }) {
  return (
    <header className="sticky top-0 z-40 border-b border-rule bg-paper">
      <div className="mx-auto flex h-14 max-w-app items-center gap-3 px-4 md:h-[60px] md:gap-4 md:px-6">
        <Link href="/" aria-label="Taro home" className="shrink-0 rounded-control">
          <Wordmark size="app" />
        </Link>
        {children}
      </div>
    </header>
  );
}

export function DashboardHeader({
  workspace,
  me,
  tabs,
  onMembers,
  onSettings,
  onSignOut,
}: {
  workspace: Workspace;
  me: User;
  tabs: ViewTab[];
  onMembers: () => void;
  onSettings: () => void;
  onSignOut: () => void;
}) {
  const domain = workspace.slackTeamDomain ? `${workspace.slackTeamDomain}.slack.com` : null;
  return (
    <>
      <HeaderBar>
        <span aria-hidden="true" className="hidden h-[22px] w-px shrink-0 bg-rule md:block" />
        <p className="min-w-0 truncate text-ui font-semibold text-ink">
          {workspace.name}
          {domain && <span className="ml-1.5 hidden font-normal text-ash lg:inline">{domain}</span>}
        </p>
        <ViewTabs tabs={tabs} className="ml-[18px] hidden h-full shrink-0 md:flex" />
        <Menu className="ml-auto shrink-0">
          <MenuTrigger className="flex items-center gap-2 rounded-full py-1 pl-1 pr-2 text-ui text-ink hover:bg-poi">
            <Avatar name={me.name} src={me.avatarUrl} />
            <span className="hidden max-w-[10rem] truncate font-medium md:inline">{me.name}</span>
            <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true" className="h-3 w-3 text-ash">
              <path d="M5 8l5 5 5-5" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
            <span className="sr-only">Account menu</span>
          </MenuTrigger>
          <MenuPopover label="Account" header={<MenuHeader name={me.name} detail={`${ROLE_NAMES[me.role]} · ${workspace.name}`} />}>
            <MenuItem onSelect={onMembers}>Members</MenuItem>
            {me.role !== 'member' && <MenuItem onSelect={onSettings}>Workspace settings</MenuItem>}
            <MenuLink href="/demo">See the demo</MenuLink>
            <MenuSeparator />
            <MenuItem onSelect={onSignOut}>Sign out</MenuItem>
          </MenuPopover>
        </Menu>
      </HeaderBar>
      <ViewTabs tabs={tabs} className="sticky top-14 z-30 h-[46px] border-b border-rule bg-paper px-4 md:hidden" />
    </>
  );
}
