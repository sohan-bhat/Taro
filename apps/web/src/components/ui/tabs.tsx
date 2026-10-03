'use client';

import * as React from 'react';
import Link from 'next/link';
import { cn } from '@/lib/utils';

// The active indicator is an inset shadow; globals.css swaps it for a real border in contrast themes.
const VIEW_TAB =
  'inline-flex h-full items-center whitespace-nowrap text-ui font-semibold text-ash transition-colors hover:text-ink ' +
  'aria-[current=page]:text-ink aria-[current=page]:shadow-[inset_0_-2px_0_theme(colors.taro.DEFAULT)]';

export interface ViewTab {
  href: string;
  label: string;
  current: boolean;
  // Shown after the label in Taro purple while there is one, for example "2 to finish"
  note?: string;
}

/**
 * The dashboard's Meetings and Setup tabs: links that set ?view=, 24px apart. The caller sets the
 * layout (`ml-[18px] hidden h-full md:flex` in the header, the sticky 46px row on phones).
 */
export function ViewTabs({
  tabs,
  onNavigate,
  className,
  'aria-label': ariaLabel = 'Workspace',
}: {
  tabs: ViewTab[];
  // Runs before navigation, for example to move focus to the new view's heading once it renders
  onNavigate?: (tab: ViewTab) => void;
  className?: string;
  'aria-label'?: string;
}) {
  return (
    <nav aria-label={ariaLabel} className={cn('flex items-stretch gap-6', className)}>
      {tabs.map((tab) => (
        <Link
          key={tab.href}
          href={tab.href}
          scroll={false}
          aria-current={tab.current ? 'page' : undefined}
          onClick={() => onNavigate?.(tab)}
          className={VIEW_TAB}
        >
          {tab.label}
          {tab.note ? <span className="ml-1.5 text-meta font-semibold text-taro">{tab.note}</span> : null}
        </Link>
      ))}
    </nav>
  );
}

const SEGMENT =
  'inline-flex min-h-11 items-center text-sm font-semibold text-ash transition-colors hover:text-ink ' +
  'aria-pressed:text-ink aria-pressed:shadow-[inset_0_-2px_0_theme(colors.taro.DEFAULT)] md:min-h-0 md:pb-0.5';

/** Two or three pressed-state buttons, 16px apart, like the meeting list's Recent and Archive. No pills. */
export function Segmented<T extends string>({
  options,
  value,
  onChange,
  label,
  className,
}: {
  options: ReadonlyArray<{ value: T; label: string }>;
  value: T;
  onChange: (value: T) => void;
  // The group's accessible name, for example "Which meetings"
  label: string;
  className?: string;
}) {
  return (
    <div role="group" aria-label={label} className={cn('flex gap-4', className)}>
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          aria-pressed={option.value === value}
          onClick={() => onChange(option.value)}
          className={SEGMENT}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}
