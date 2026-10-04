'use client';

// The public demo (9.8): a real Taro workspace from a frozen snapshot, shown with the dashboard's
// own shell and components, read-only. The address carries the view (?view=setup) and the meeting
// (?m=) as it does on the dashboard. Every time is printed in the snapshot's zone and compared with
// the moment it was saved, never the real clock, so the prerendered page and the browser agree.

import * as React from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import type { Meeting } from '@taro/shared';
import { demo, MAX_DURATION_MS } from '@/demo/adapt';
import { cn } from '@/lib/utils';
import { SignInWithSlackButton } from '@/components/sign-in';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import type { ViewTab } from '@/components/ui/tabs';
import { useMediaQuery, WIDE } from '@/components/dashboard/common';
import { WorkspaceHeader } from '@/components/dashboard/header';
import { MeetingDetailPanel, MeetingList, type ListMode } from '@/components/dashboard/meetings';
import { DemoSetupView } from './demo-setup';

type View = 'meetings' | 'setup';

const MAIN = 'mx-auto max-w-app px-4 pb-16 pt-4 md:px-6 md:pt-7';
const MEETINGS_HREF = '/demo';
const SETUP_HREF = '/demo?view=setup';
const meetingHref = (id: string) => `/demo?m=${encodeURIComponent(id)}`;
// The exporter keeps archived meetings with the rest, as history, so the demo's archive is empty.
const ARCHIVED: Meeting[] = [];

/**
 * Focus follows the dashboard's rules (9.3): a view change lands on the new view's first visible
 * heading. Below 1100px opening a meeting lands on its title and "All meetings" returns to its row;
 * in two panes focus stays on the row. Nothing moves on the first render.
 */
function useViewFocus(view: View, selected?: string) {
  const before = React.useRef<{ view: View; selected?: string } | null>(null);
  React.useEffect(() => {
    const prev = before.current;
    before.current = { view, selected };
    if (!prev) return;
    const wide = window.matchMedia(WIDE).matches;
    let id: string | undefined;
    let backToRow = false;
    if (prev.view !== view) {
      id = view === 'setup' ? 'setup-title' : selected && !wide ? 'detail-title' : 'list-title';
    } else if (view === 'meetings' && !wide && prev.selected !== selected) {
      if (selected) id = 'detail-title';
      else if (prev.selected) {
        id = `meeting-${prev.selected}`;
        backToRow = true;
      }
    }
    const el = id ? document.getElementById(id) : null;
    if (!el) return;
    // A new view starts at the top at once; the page's smooth scrolling is for in-page links.
    if (backToRow) el.scrollIntoView({ block: 'center', behavior: 'instant' as ScrollBehavior });
    else window.scrollTo({ top: 0, behavior: 'instant' as ScrollBehavior });
    el.focus({ preventScroll: true });
  }, [view, selected]);
}

function NoticeBar() {
  // Ink, not Taro: a Taro field in the dashboard means a meeting happening now.
  return (
    <div className="on-ink bg-ink px-4 py-2.5 text-sm text-poi md:px-6">
      <div className="mx-auto flex max-w-app flex-wrap items-baseline gap-x-4 gap-y-1">
        <p>A real Taro workspace, saved {demo.savedOn}. Everything here happened. Nothing is live.</p>
        <Link
          href="/signin"
          className="inline-flex min-h-11 items-center rounded-sm font-semibold text-white underline decoration-white/60 underline-offset-[3px] hover:decoration-white md:min-h-0"
        >
          Sign in with Slack
        </Link>
      </div>
    </div>
  );
}

function DemoMeetings({
  selected,
  mode,
  setMode,
}: {
  selected?: string;
  mode: ListMode;
  setMode: (mode: ListMode) => void;
}) {
  const router = useRouter();
  // Rows replace the address in two panes (selection is not history) and push below 1100px.
  const wide = useMediaQuery(WIDE);

  const meetings = mode === 'archive' ? ARCHIVED : demo.meetings;
  // With no meeting chosen, Recent opens on the featured meeting; the empty archive opens on nothing.
  const shownId = selected ?? (mode === 'recent' ? demo.featuredId : undefined);
  const missing = !!selected && !demo.details[selected];
  // Below 1100px a chosen meeting is its own view under "All meetings"; from 1100px it sits beside the list.
  // CSS makes the switch, so the prerendered page is right at every width before any script runs.
  const own = !!selected;

  const changeMode = (next: ListMode) => {
    if (next === mode) return;
    setMode(next);
    // Switching lists lets go of the chosen meeting, as on the dashboard.
    if (selected) router.replace(MEETINGS_HREF, { scroll: false });
  };

  return (
    <>
      <h1 className="sr-only">Meetings</h1>
      <div className={cn(own && 'hidden wide:block')}>
        <p className="max-w-[44ch] text-[20px] font-bold leading-[1.3] tracking-[-0.015em]">{demo.summary}</p>
        {/* In place of "Send Taro to a meeting": the demo can't send Taro anywhere. */}
        <Card className="mt-5 flex flex-col gap-3 p-4 md:flex-row md:items-center md:justify-between md:p-6">
          <p className="text-ui text-ink-2">In your own workspace, you paste a meeting link here or post it in Slack.</p>
          <SignInWithSlackButton size="sm" className="w-full md:w-auto" />
        </Card>
      </div>
      {own && !missing && (
        <Button asChild variant="link" size="sm" className="mb-2 wide:hidden">
          <Link href={MEETINGS_HREF} scroll={false}>
            All meetings
          </Link>
        </Button>
      )}
      <div className={cn('grid gap-5 wide:grid-cols-[380px_minmax(0,1fr)] wide:items-start', own ? 'wide:mt-5' : 'mt-5')}>
        <div className={cn('min-w-0', own && 'hidden wide:block')}>
          <MeetingList
            meetings={meetings}
            mode={mode}
            onModeChange={changeMode}
            selectedId={shownId}
            hrefFor={meetingHref}
            replace={wide}
            now={demo.now}
            timeZone={demo.timeZone}
            maxDurationMs={MAX_DURATION_MS}
          />
        </div>
        {shownId && (
          <MeetingDetailPanel
            key={shownId}
            meeting={demo.meetings.find((m) => m._id === shownId)}
            detail={demo.details[shownId]}
            missing={missing}
            botName="Taro"
            enabledActions={demo.setup.github.enabledActions}
            allMeetingsHref={MEETINGS_HREF}
            now={demo.now}
            timeZone={demo.timeZone}
            maxDurationMs={MAX_DURATION_MS}
            explainMisheard
          />
        )}
      </div>
    </>
  );
}

/** The whole demo for one address. With no props it is the default view, which is what the page prerenders. */
export function DemoApp({ view = 'meetings', selected }: { view?: View; selected?: string }) {
  useViewFocus(view, selected);
  // Here rather than in the Meetings view, so Recent or Archive survives a trip to Setup, as on the dashboard.
  const [mode, setMode] = React.useState<ListMode>('recent');
  const tabs: ViewTab[] = [
    { href: MEETINGS_HREF, label: 'Meetings', current: view === 'meetings' },
    { href: SETUP_HREF, label: 'Setup', current: view === 'setup' },
  ];

  return (
    <>
      <NoticeBar />
      <WorkspaceHeader
        name={demo.name}
        domain={demo.domain}
        tabs={tabs}
        end={
          <Button asChild variant="secondary" size="sm" className="ml-auto shrink-0">
            <Link href="/">Exit demo</Link>
          </Button>
        }
      />
      <main id="main" className={MAIN}>
        {view === 'setup' ? (
          <DemoSetupView name={demo.name} setup={demo.setup} />
        ) : (
          <DemoMeetings selected={selected} mode={mode} setMode={setMode} />
        )}
        <p className="py-8 text-center text-meta text-ash">
          Snapshot captured {demo.savedOn}. Times are {demo.zoneName}. No live server behind this page.
        </p>
      </main>
    </>
  );
}

/** The demo the address asks for. Prerendering has no address, so the page shows <DemoApp /> until this takes over. */
export function DemoFromAddress() {
  const params = useSearchParams();
  return <DemoApp view={params.get('view') === 'setup' ? 'setup' : 'meetings'} selected={params.get('m') || undefined} />;
}
