'use client';

// The signed-in dashboard: loading and polling, the URL state (?view, ?m, ?open), the results
// of the Slack, GitHub, and Google Calendar flows, focus on view changes, and the shell around
// the Meetings and Setup views.

import * as React from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import type { GithubAccountChoice, Meeting, MeetingDetail, ServerMeta, UpcomingMeeting, WorkspaceOverview } from '@taro/shared';
import { api, ApiError, isSessionError } from '@/lib/api';
import { nextTail, type TailState } from '@/lib/live-tail';
import { isLive, missingToJoin, setupSteps, sortMeetings } from '@/lib/meeting-state';
import { clearToken, getToken } from '@/lib/session';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import type { ViewTab } from '@/components/ui/tabs';
import { showToast } from '@/components/ui/toast-store';
import { Delayed, errorText, focusIfLost, SessionGuard, useMediaQuery, WIDE } from './common';
import { GithubAccountDialog } from './github-dialogs';
import { DashboardHeader, HeaderBar } from './header';
import {
  LiveSlab,
  MeetingDetailPanel,
  MeetingList,
  MeetingSources,
  toastSent,
  UpcomingInvites,
  type CalendarJoining,
  type ListMode,
  type SendResult,
  type UpcomingAction,
} from './meetings';
import { SetupView } from './setup';
import { MembersDialog, SettingsDialog } from './workspace-dialogs';

// Problems the Slack and GitHub install flows report on their way back here.
const RETURN_ERRORS: Record<string, string> = {
  slack_expired: 'Adding Taro to Slack took too long. Try again.',
  slack_denied: 'Adding Taro to Slack was canceled.',
  slack_missing_code: "Slack didn't finish adding Taro. Try again.",
  slack_failed: "Slack didn't finish adding Taro. Try again.",
  slack_team_mismatch: 'Taro was added to a different Slack workspace than the one you signed in with. Add it to this one instead.',
  slack_team_taken: "That Slack workspace already belongs to another Taro workspace, so it can't be added here.",
  slack_other_team: 'This workspace is already connected to a different Slack workspace. Remove that one in Setup first.',
  workspace_not_found: 'That workspace no longer exists.',
  github_expired: 'Connecting GitHub took too long. Try again.',
  github_unverified: "This Taro server can't verify GitHub installations yet. Ask whoever runs it to finish the GitHub app setup.",
  github_needs_authorization: "GitHub didn't confirm your account. Ask whoever runs this Taro server to turn on user authorization for the GitHub app.",
  github_not_yours: "That GitHub installation isn't one your account can access.",
  github_no_installations: "The Taro app isn't installed on any GitHub account you can access yet. Install it first.",
  github_no_push_access:
    "Your GitHub account can't push to any repository the Taro app has access to. Grant Taro a repository you can push to, then connect again.",
  github_failed: "GitHub didn't finish connecting. Try again.",
  calendar_expired: 'Connecting Google Calendar took too long. Try again.',
  calendar_denied: 'Connecting Google Calendar was canceled.',
  calendar_scope: 'Taro can only join your meetings if it can see your calendar events. Connect again and allow that.',
  calendar_unavailable: "Google Calendar isn't set up on this Taro server.",
  calendar_failed: "Google didn't finish connecting your calendar. Try again.",
  linear_expired: 'Connecting Linear took too long. Try again.',
  linear_denied: 'Connecting Linear was canceled.',
  linear_failed: "Linear didn't finish connecting. Try again.",
};
const RETURN_PARAMS = ['slack', 'github', 'error', 'githubConnect', 'calendarConnect', 'linearConnect'];

const MAIN = 'mx-auto max-w-app px-4 pb-16 pt-4 md:px-6 md:pt-7';
const FAST_POLL = 4_000;
const SLOW_POLL = 30_000;

type View = 'meetings' | 'setup';

const meetingHref = (id: string) => `/dashboard?m=${encodeURIComponent(id)}`;
const MEETINGS_HREF = '/dashboard?view=meetings';

/** Sign-in, carrying this address along so a deep link (a meeting from the Meet button) survives it. */
function signInPath(error?: string): string {
  const query = new URLSearchParams();
  if (error) query.set('error', error);
  const here = new URLSearchParams(window.location.search);
  RETURN_PARAMS.forEach((p) => here.delete(p));
  if (here.toString()) query.set('next', `/dashboard?${here}`);
  return query.toString() ? `/signin?${query}` : '/signin';
}

/** The shell before the workspace arrives: the wordmark, then a quiet line after 400 ms. */
export function DashboardLoading() {
  return (
    <>
      <HeaderBar />
      <main id="main" className={MAIN}>
        <Delayed>
          <p className="pt-12 text-center text-sm text-ash">Loading your workspace</p>
        </Delayed>
      </main>
    </>
  );
}

export function DashboardApp() {
  const router = useRouter();
  const params = useSearchParams();
  const wide = useMediaQuery(WIDE);

  const [overview, setOverview] = React.useState<WorkspaceOverview | null>(null);
  const [loadFailed, setLoadFailed] = React.useState(false);
  const [meta, setMeta] = React.useState<ServerMeta | null>(null);
  // Meetings Taro will join from calendars; null until loaded, and while the server offers no calendar
  const [upcoming, setUpcoming] = React.useState<UpcomingMeeting[] | null>(null);
  const [upcomingPending, setUpcomingPending] = React.useState<{ id: string; action: UpcomingAction } | null>(null);
  const [meetings, setMeetings] = React.useState<Meeting[] | null>(null);
  const [meetingsError, setMeetingsError] = React.useState('');
  const [archived, setArchived] = React.useState<Meeting[] | null>(null);
  const [archiveError, setArchiveError] = React.useState('');
  const [mode, setMode] = React.useState<ListMode>('recent');
  const [details, setDetails] = React.useState<Record<string, MeetingDetail | 'missing'>>({});
  const [archiving, setArchiving] = React.useState(false);
  const [leavingId, setLeavingId] = React.useState<string | null>(null);
  const [resending, setResending] = React.useState(false);
  const [dialog, setDialog] = React.useState<'members' | 'settings' | null>(null);
  const [githubChoices, setGithubChoices] = React.useState<{ token: string; choices: GithubAccountChoice[] } | null>(null);
  const [refreshTick, setRefreshTick] = React.useState(0);
  // A meeting whose detail failed to load for a reason other than a 404, with the message to show
  const [detailErrors, setDetailErrors] = React.useState<Record<string, string>>({});

  // What each live meeting's tail last showed, so only newly arrived words count as fresh.
  const tails = React.useRef(new Map<string, TailState>());
  // Signing out, deleting, or a dead session: stop loading and never redirect twice.
  const exiting = React.useRef(false);
  // The view for a bare /dashboard, decided once so finishing setup doesn't pull the page away.
  const defaultView = React.useRef<View | null>(null);

  const handleError = React.useCallback(
    (error: unknown) => {
      if (!isSessionError(error)) return false;
      if (!exiting.current) {
        exiting.current = true;
        clearToken();
        router.replace(signInPath('session'));
      }
      return true;
    },
    [router]
  );

  const observe = React.useCallback((list: readonly Meeting[]) => {
    for (const m of list) {
      const text = m.liveTranscript;
      if (!isLive(m) || !text) continue;
      const prev = tails.current.get(m._id);
      // A slower response carrying older text; the newer text is already showing.
      if (prev && prev.text !== text && prev.text.startsWith(text)) continue;
      tails.current.set(m._id, nextTail(prev, text));
    }
  }, []);

  const loadOverview = React.useCallback(async () => {
    if (exiting.current) return;
    try {
      const next = await api.workspace.overview();
      if (exiting.current) return;
      setOverview(next);
      setLoadFailed(false);
    } catch (error) {
      if (!handleError(error)) setLoadFailed(true);
    }
  }, [handleError]);

  const loadMeetings = React.useCallback(async () => {
    if (exiting.current) return;
    try {
      const { meetings: list } = await api.meetings.list();
      if (exiting.current) return;
      observe(list);
      setMeetings(list);
      setMeetingsError('');
    } catch (error) {
      if (!handleError(error)) setMeetingsError(errorText(error, "Couldn't load meetings."));
    }
  }, [handleError, observe]);

  const loadArchive = React.useCallback(async () => {
    if (exiting.current) return;
    try {
      const { meetings: list } = await api.meetings.list(true);
      if (exiting.current) return;
      setArchived(list);
      setArchiveError('');
    } catch (error) {
      if (!handleError(error)) setArchiveError(errorText(error, "Couldn't load the archive."));
    }
  }, [handleError]);

  const loadUpcoming = React.useCallback(async () => {
    if (exiting.current) return;
    try {
      const { upcoming: list } = await api.calendar.upcoming();
      if (!exiting.current) setUpcoming(list);
    } catch (error) {
      // The list is extra; when it can't load, the rest of the page carries on without it.
      handleError(error);
    }
  }, [handleError]);

  // First load. No token means nobody is signed in here.
  React.useEffect(() => {
    if (!getToken()) {
      exiting.current = true;
      router.replace(signInPath());
      return;
    }
    loadOverview();
    loadMeetings();
    api
      .meta()
      .then((m) => !exiting.current && setMeta(m))
      .catch(() => {});
  }, [router, loadOverview, loadMeetings]);

  // The Slack, GitHub, and Google Calendar flows come back with their result in the address. Show
  // it once, then drop it. Every one starts on Setup, so that's where it lands.
  const handledReturn = React.useRef(false);
  React.useEffect(() => {
    if (handledReturn.current || exiting.current) return;
    handledReturn.current = true;
    const slack = params.get('slack');
    const github = params.get('github');
    const error = params.get('error');
    const connectToken = params.get('githubConnect');
    const calendarToken = params.get('calendarConnect');
    const linearToken = params.get('linearConnect');
    if (!slack && !github && !error && !connectToken && !calendarToken && !linearToken) return;
    if (slack === 'connected') showToast('Taro is in your Slack.');
    if (github === 'connected') showToast('GitHub connected.');
    if (error) {
      // Own keys only: the code comes from the address bar.
      const known = Object.prototype.hasOwnProperty.call(RETURN_ERRORS, error);
      showToast(known ? RETURN_ERRORS[error] : "That didn't finish. Try again.", 'error');
    }
    if (connectToken) {
      // GitHub confirmed the account; connecting needs this session, so it happens here, not in the callback.
      api.github
        .connect(connectToken)
        .then((res) => {
          if (res.connected) {
            showToast('GitHub connected.');
            loadOverview();
          } else if (res.choices?.length) {
            setGithubChoices({ token: connectToken, choices: res.choices });
          }
        })
        .catch((e) => {
          if (!handleError(e)) showToast(errorText(e, "Couldn't connect GitHub."), 'error');
        });
    }
    if (calendarToken) {
      // Google confirmed the account; only this person's session can finish connecting it.
      api.googleCalendar
        .connect(calendarToken)
        .then(() => {
          showToast('Google Calendar connected. Taro joins your meetings from now on.');
          loadOverview();
          // The first read of the calendar takes a moment; its meetings show up without waiting for the next poll.
          window.setTimeout(() => {
            loadOverview();
            loadUpcoming();
          }, 4_000);
        })
        .catch((e) => {
          if (!handleError(e)) showToast(errorText(e, "Couldn't connect Google Calendar."), 'error');
        });
    }
    if (linearToken) {
      // Linear installed the app; only this person's session can finish connecting it.
      api.linear
        .connect(linearToken)
        .then(({ linear }) => {
          showToast(`Linear connected${linear.siteName ? ` to ${linear.siteName}` : ''}.`);
          loadOverview();
        })
        .catch((e) => {
          if (!handleError(e)) showToast(errorText(e, "Couldn't connect Linear."), 'error');
        });
    }
    router.replace('/dashboard?view=setup', { scroll: false });
  }, [params, router, loadOverview, loadUpcoming, handleError]);

  // Meetings poll every 4 seconds while one is starting, in the lobby, or live; every 30 otherwise.
  const loaded = !!overview;
  const anyLive = !!meetings?.some(isLive);
  React.useEffect(() => {
    if (!loaded) return;
    const timer = window.setInterval(() => {
      if (document.visibilityState === 'visible') loadMeetings();
    }, anyLive ? FAST_POLL : SLOW_POLL);
    return () => window.clearInterval(timer);
  }, [loaded, anyLive, loadMeetings]);

  // Upcoming calendar meetings refresh every 30 seconds, and when the tab comes back.
  const calendarInvites = !!meta?.calendarInvites;
  const upcomingOn = calendarInvites || !!meta?.googleCalendar;
  React.useEffect(() => {
    if (!loaded || !upcomingOn) return;
    loadUpcoming();
    const onVisible = () => {
      if (document.visibilityState === 'visible') loadUpcoming();
    };
    const timer = window.setInterval(onVisible, SLOW_POLL);
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [loaded, upcomingOn, loadUpcoming]);

  // Hidden tabs skip their polls, so a tab coming back catches up at once.
  React.useEffect(() => {
    let last = 0;
    const refresh = () => {
      if (document.visibilityState !== 'visible' || exiting.current) return;
      if (Date.now() - last < 2_000) return;
      last = Date.now();
      loadMeetings();
      loadOverview();
      setRefreshTick((t) => t + 1);
    };
    document.addEventListener('visibilitychange', refresh);
    window.addEventListener('focus', refresh);
    return () => {
      document.removeEventListener('visibilitychange', refresh);
      window.removeEventListener('focus', refresh);
    };
  }, [loadMeetings, loadOverview]);

  // ---- URL state

  const viewParam = params.get('view');
  const selectedParam = params.get('m') || undefined;
  const openParam = params.get('open');
  // Back from an install flow: Setup from the first render, so the page doesn't switch views under its toasts.
  const returning = RETURN_PARAMS.some((p) => params.has(p));
  const steps = overview ? setupSteps(overview) : null;
  if (steps && defaultView.current === null) defaultView.current = steps.todo > 0 || returning ? 'setup' : 'meetings';
  const view: View =
    viewParam === 'setup' || viewParam === 'meetings'
      ? viewParam
      : selectedParam
        ? 'meetings'
        : openParam === 'permissions' || returning
          ? 'setup'
          : defaultView.current ?? 'meetings';

  const listMeetings = mode === 'archive' ? archived : meetings;
  const sorted = React.useMemo(() => (listMeetings ? sortMeetings(listMeetings) : null), [listMeetings]);
  // Two panes show the first meeting when none is chosen; one pane shows the list.
  const selectedId = selectedParam ?? (wide ? sorted?.[0]?._id : undefined);
  const listItem = selectedId ? meetings?.find((m) => m._id === selectedId) ?? archived?.find((m) => m._id === selectedId) : undefined;
  const cached = selectedId ? details[selectedId] : undefined;
  const detail = cached && cached !== 'missing' ? cached : null;
  const selected = listItem ?? detail ?? undefined;
  const selectedLive = !!selected && isLive(selected);
  // When the list sees the meeting change (it ended, its requests were counted), fetch it again.
  const version = listItem ? [listItem.status, listItem.endedAt, listItem.archivedAt, JSON.stringify(listItem.tally ?? null)].join('|') : '';

  React.useEffect(() => {
    if (!loaded || view !== 'meetings' || !selectedId) return;
    let cancelled = false;
    const load = async () => {
      try {
        const { meeting } = await api.meetings.get(selectedId);
        if (cancelled || exiting.current) return;
        observe([meeting]);
        setDetails((d) => ({ ...d, [selectedId]: meeting }));
        setDetailErrors((e) => (e[selectedId] ? { ...e, [selectedId]: '' } : e));
      } catch (error) {
        if (cancelled || handleError(error)) return;
        if (error instanceof ApiError && error.status === 404) setDetails((d) => ({ ...d, [selectedId]: 'missing' }));
        else {
          const message = errorText(error, "Couldn't load this meeting. Check your connection and try again.");
          setDetailErrors((e) => ({ ...e, [selectedId]: message }));
        }
      }
    };
    load();
    if (!selectedLive) {
      return () => {
        cancelled = true;
      };
    }
    // A live meeting's detail polls every 4 seconds, and not in a hidden tab.
    const timer = window.setInterval(() => {
      if (document.visibilityState === 'visible') load();
    }, FAST_POLL);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [loaded, view, selectedId, selectedLive, version, refreshTick, handleError, observe]);

  // A deep link to an archived meeting shows the Archive list around it.
  const checkedArchive = React.useRef(new Set<string>());
  React.useEffect(() => {
    if (!selectedParam || !detail || checkedArchive.current.has(selectedParam)) return;
    checkedArchive.current.add(selectedParam);
    if (detail.archivedAt && mode === 'recent') setMode('archive');
  }, [selectedParam, detail, mode]);

  React.useEffect(() => {
    if (loaded && mode === 'archive' && archived === null) loadArchive();
  }, [loaded, mode, archived, loadArchive]);

  // ---- Focus (9.3): a view change lands on its first visible heading; opening a meeting on one
  // pane lands on its title, and leaving it goes back to its row.

  // `meeting`: wait until that meeting is the one on screen
  const pendingFocus = React.useRef<{ id: string; at: number; scroll: 'top' | 'center'; meeting?: string } | null>(null);
  const prevView = React.useRef<View | null>(null);
  // null until the first loaded render, so a deep link that opens on a meeting doesn't move focus
  const prevSelected = React.useRef<string | undefined | null>(null);
  const narrowDetail = !wide && !!selectedParam;

  React.useEffect(() => {
    if (!loaded) return;
    const before = prevView.current;
    prevView.current = view;
    if (!before || before === view) return;
    const id = view === 'setup' ? 'setup-title' : narrowDetail ? 'detail-title' : 'send-title';
    pendingFocus.current = { id, at: Date.now(), scroll: 'top' };
  }, [loaded, view, narrowDetail]);

  React.useEffect(() => {
    if (!loaded) return;
    const before = prevSelected.current;
    prevSelected.current = selectedParam;
    if (before === null || view !== 'meetings' || wide || before === selectedParam) return;
    if (selectedParam) pendingFocus.current = { id: 'detail-title', at: Date.now(), scroll: 'top' };
    else if (before) pendingFocus.current = { id: `meeting-${before}`, at: Date.now(), scroll: 'center' };
  }, [loaded, view, wide, selectedParam]);

  // Runs after every render: the target may only appear once its data arrives. An open dialog keeps focus.
  React.useEffect(() => {
    const p = pendingFocus.current;
    if (!p) return;
    if (Date.now() - p.at > 3_000 || document.querySelector('[data-dialog-panel]')) {
      pendingFocus.current = null;
      return;
    }
    if (p.meeting && p.meeting !== selectedId) return;
    const el = document.getElementById(p.id);
    if (!el) return;
    pendingFocus.current = null;
    // A new view starts at the top at once; the page's smooth scrolling is for in-page links.
    if (p.scroll === 'top') window.scrollTo({ top: 0, behavior: 'instant' as ScrollBehavior });
    else el.scrollIntoView({ block: 'center', behavior: 'instant' as ScrollBehavior });
    el.focus({ preventScroll: true });
  });

  // The server titles ?view= pages; a bare /dashboard can open on Setup, so the title follows the view.
  React.useEffect(() => {
    if (loaded) document.title = `${view === 'setup' ? 'Setup' : 'Meetings'} · Taro`;
  }, [loaded, view, params]);

  // Finishing the required set: say so once, and record it the way "Finish setup" used to.
  const prevTodo = React.useRef<number | null>(null);
  const onboardingSent = React.useRef(false);
  React.useEffect(() => {
    if (!overview) return;
    const { todo } = setupSteps(overview);
    if (prevTodo.current !== null && prevTodo.current > 0 && todo === 0) {
      showToast("You're all set. Send Taro to your next meeting.");
    }
    prevTodo.current = todo;
    if (todo === 0 && overview.me.role !== 'member' && !overview.workspace.onboardedAt && !onboardingSent.current) {
      onboardingSent.current = true;
      api.workspace
        .completeOnboarding()
        .then(({ workspace }) => !exiting.current && setOverview((o) => (o ? { ...o, workspace } : o)))
        .catch(() => {});
    }
  }, [overview]);

  // ---- Actions

  const signOut = async () => {
    exiting.current = true;
    await api.auth.logout().catch(() => {});
    clearToken();
    router.replace('/');
    showToast("You're signed out.");
  };

  const onDeleted = (name: string) => {
    exiting.current = true;
    clearToken();
    setDialog(null);
    router.replace('/');
    showToast(`Deleted ${name} from Taro.`);
  };

  // Show a meeting Taro was just sent to right away; the next poll fills in the rest.
  const remember = (meeting: Meeting) =>
    setMeetings((list) => (list && !list.some((m) => m._id === meeting._id) ? [meeting, ...list] : list));

  const onSent = (result: SendResult) => {
    remember(result.meeting);
    loadMeetings();
    if (wide) router.replace(meetingHref(result.meeting._id), { scroll: false });
  };

  const resend = async (meeting: Meeting) => {
    setResending(true);
    try {
      const result = await api.meetings.send(meeting.meetUrl);
      toastSent(result);
      remember(result.meeting);
      loadMeetings();
      router.replace(meetingHref(result.meeting._id), { scroll: false });
      // The new meeting replaces this one, and its title takes focus once it shows.
      pendingFocus.current = { id: 'detail-title', at: Date.now(), scroll: 'center', meeting: result.meeting._id };
    } catch (error) {
      if (!handleError(error)) {
        showToast(errorText(error, "Taro couldn't join that meeting."), 'error');
        if (error instanceof ApiError && error.status === 412) loadOverview();
      }
    } finally {
      setResending(false);
    }
  };

  const leave = async (id: string) => {
    setLeavingId(id);
    try {
      const { meeting } = await api.meetings.leave(id);
      showToast('Taro left the meeting.');
      // Show the ended meeting now; its title takes focus, since the button that had it is gone.
      if (meeting?._id) {
        setMeetings((list) => list?.map((m) => (m._id === meeting._id ? { ...m, ...meeting } : m)) ?? list);
        setDetails((d) => {
          const known = d[meeting._id];
          return known && known !== 'missing' ? { ...d, [meeting._id]: { ...known, ...meeting } } : d;
        });
      }
      pendingFocus.current = { id: 'detail-title', at: Date.now(), scroll: 'center' };
      loadMeetings();
      setRefreshTick((t) => t + 1);
    } catch (error) {
      if (!handleError(error)) showToast(errorText(error, "Couldn't reach the meeting bot."), 'error');
    } finally {
      setLeavingId(null);
    }
  };

  const archiveFinished = async () => {
    setArchiving(true);
    try {
      const n = Number((await api.meetings.clearHistory())?.archived) || 0;
      showToast(n === 0 ? 'Nothing to archive.' : `Archived ${n} ${n === 1 ? 'meeting' : 'meetings'}.`);
      loadMeetings();
      // The archive reloads the next time it opens.
      setArchived(null);
    } catch (error) {
      if (!handleError(error)) showToast(errorText(error, "Couldn't archive meetings."), 'error');
    } finally {
      setArchiving(false);
      // The button may be gone with the meetings it archived.
      focusIfLost('list-title');
    }
  };

  const actOnUpcoming = async (meeting: UpcomingMeeting, action: UpcomingAction) => {
    setUpcomingPending({ id: meeting._id, action });
    try {
      const { upcoming: list } = await api.calendar.act(meeting._id, action);
      setUpcoming(list);
      const many = meeting.recurring;
      showToast(
        action === 'skip'
          ? "Skipped. Taro won't join that one."
          : action === 'restore'
            ? 'Taro will join that one at the start.'
            : action === 'approve'
              ? many
                ? 'Approved. Taro joins each one at the start.'
                : 'Approved. Taro joins at the start.'
              : many
                ? "Declined. Taro won't join any of them."
                : "Declined. Taro won't join."
      );
      // One about to start can turn into a meeting at any moment.
      loadMeetings();
    } catch (error) {
      if (!handleError(error)) showToast(errorText(error, "Couldn't change that meeting. Try again."), 'error');
      loadUpcoming();
    } finally {
      setUpcomingPending(null);
      // The row's buttons change or go away with it.
      focusIfLost('upcoming-title');
    }
  };

  const changeMode = (next: ListMode) => {
    if (next === mode) return;
    setMode(next);
    if (next === 'archive') loadArchive();
    // A new list starts at its own first meeting.
    if (selectedParam) router.replace(MEETINGS_HREF, { scroll: false });
  };

  // ---- Render

  if (!overview) {
    return (
      <SessionGuard value={handleError}>
        <HeaderBar />
        <main id="main" className={MAIN}>
          {loadFailed ? (
            <div className="mx-auto max-w-setup pt-6">
              <Alert tone="error">
                <p>Couldn&apos;t load your workspace. Check your connection and try again.</p>
                <Button
                  variant="secondary"
                  size="sm"
                  className="mt-3"
                  onClick={() => {
                    setLoadFailed(false);
                    loadOverview();
                    if (!meetings) loadMeetings();
                  }}
                >
                  Try again
                </Button>
              </Alert>
            </div>
          ) : (
            <Delayed>
              <p className="pt-12 text-center text-sm text-ash">Loading your workspace</p>
            </Delayed>
          )}
        </main>
      </SessionGuard>
    );
  }

  const { workspace, me, ready, slack, github } = overview;
  const canEdit = me.role !== 'member';
  const myCalendar = overview.googleCalendar;
  const googleCalendar: CalendarJoining = !meta?.googleCalendar
    ? undefined
    : myCalendar?.connected && !myCalendar.needsReconnect && myCalendar.autoJoin !== false
      ? 'on'
      : 'off';
  const todo = steps?.todo ?? 0;
  const now = Date.now();
  const tabs: ViewTab[] = [
    { href: MEETINGS_HREF, label: 'Meetings', current: view === 'meetings' },
    { href: '/dashboard?view=setup', label: 'Setup', current: view === 'setup', note: todo ? `${todo} to finish` : undefined },
  ];

  const detailPanel = selectedId ? (
    <MeetingDetailPanel
      key={selectedId}
      meeting={listItem}
      detail={detail}
      missing={cached === 'missing'}
      // A poll that fails after the meeting loaded keeps showing what's there
      loadError={detail ? undefined : detailErrors[selectedId] || undefined}
      onRetry={() => {
        setDetailErrors((e) => ({ ...e, [selectedId]: '' }));
        setRefreshTick((t) => t + 1);
      }}
      tail={tails.current.get(selectedId)}
      botName={workspace.botName}
      canEdit={canEdit}
      enabledActions={github.enabledActions}
      onResend={ready.canJoinMeetings && selected ? () => resend(selected) : undefined}
      resending={resending}
      onLeave={() => leave(selectedId)}
      leaving={leavingId === selectedId}
      allMeetingsHref={wide ? MEETINGS_HREF : undefined}
      now={now}
    />
  ) : null;

  const liveCards = !wide && meetings ? sortMeetings(meetings).filter(isLive) : [];

  return (
    <SessionGuard value={handleError}>
      <DashboardHeader
        workspace={workspace}
        me={me}
        tabs={tabs}
        onMembers={() => setDialog('members')}
        onSettings={() => setDialog('settings')}
        onSignOut={signOut}
      />
      <main id="main" className={MAIN}>
        {view === 'setup' ? (
          <SetupView
            overview={overview}
            meta={meta}
            onProviders={(providers) => {
              setOverview((o) => (o ? { ...o, providers } : o));
              // Readiness is worked out on the server from the providers.
              loadOverview();
            }}
            onChanged={() => {
              loadOverview();
              // Disconnecting a calendar, or changing which meetings it joins, changes Upcoming too
              if (upcomingOn) loadUpcoming();
            }}
            openPermissions={openParam === 'permissions'}
            onPermissionsClosed={() => {
              if (openParam) router.replace('/dashboard?view=setup', { scroll: false });
            }}
          />
        ) : (
          <>
            <h1 className="sr-only">Meetings</h1>
            {narrowDetail ? (
              <>
                <Button asChild variant="link" size="sm" className="mb-2">
                  <Link href={MEETINGS_HREF} scroll={false}>
                    All meetings
                  </Link>
                </Button>
                {detailPanel}
              </>
            ) : (
              <>
                <MeetingSources
                  canJoin={ready.canJoinMeetings}
                  missing={missingToJoin(ready)}
                  slackConnected={slack.connected}
                  calendarInvites={calendarInvites}
                  googleCalendar={googleCalendar}
                  upcoming={
                    upcomingOn ? (
                      <UpcomingInvites meetings={upcoming} canDecide={canEdit} onAction={actOnUpcoming} pending={upcomingPending} now={now} />
                    ) : null
                  }
                  onSent={onSent}
                  onNotReady={loadOverview}
                />
                <div className="mt-5 grid gap-5 wide:grid-cols-[380px_minmax(0,1fr)] wide:items-start">
                  <div className="grid min-w-0 gap-5">
                    {liveCards.map((m) => (
                      <LiveSlab
                        key={m._id}
                        meeting={m}
                        tail={tails.current.get(m._id)}
                        botName={workspace.botName}
                        variant="card"
                        href={meetingHref(m._id)}
                      />
                    ))}
                    <MeetingList
                      meetings={mode === 'archive' ? archived : meetings}
                      mode={mode}
                      onModeChange={changeMode}
                      selectedId={selectedId}
                      hrefFor={meetingHref}
                      replace={wide}
                      hideLive={!wide}
                      onArchive={archiveFinished}
                      archiving={archiving}
                      error={mode === 'archive' ? archiveError : meetingsError}
                      calendarInvites={calendarInvites}
                      googleCalendar={googleCalendar}
                      now={now}
                    />
                  </div>
                  {wide && detailPanel}
                </div>
              </>
            )}
          </>
        )}
      </main>

      <MembersDialog open={dialog === 'members'} me={me} workspace={workspace} onClose={() => setDialog(null)} />
      <SettingsDialog
        open={dialog === 'settings'}
        workspace={workspace}
        me={me}
        onClose={() => setDialog(null)}
        onSaved={(w) => setOverview((o) => (o ? { ...o, workspace: w } : o))}
        onDeleted={onDeleted}
      />
      <GithubAccountDialog
        pending={githubChoices}
        onDone={() => {
          setGithubChoices(null);
          focusIfLost('setup-title');
        }}
        onConnected={loadOverview}
      />
    </SessionGuard>
  );
}
