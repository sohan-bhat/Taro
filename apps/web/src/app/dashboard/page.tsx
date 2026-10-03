'use client';

import { Suspense, useCallback, useEffect, useRef, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import type { GithubAccountChoice, Meeting, ServerMeta, WorkspaceOverview } from '@taro/shared';
import { api, ApiError, isSessionError } from '@/lib/api';
import { clearToken, getToken } from '@/lib/session';
import { ACTIVE_STATUSES } from '@/lib/format';
import { Wordmark } from '@/components/brand';
import { Button } from '@/components/ui/button';
import { showToast } from '@/components/ui/toast-store';
import { DashboardHeader } from '@/components/dashboard/header';
import { KeysSection, type KeySlot } from '@/components/dashboard/keys';
import { ConnectionsSection } from '@/components/dashboard/connections';
import { MeetingsSection, SendToMeeting } from '@/components/dashboard/meetings';
import { SetupGuide } from '@/components/dashboard/setup-guide';
import { Section } from '@/components/paper/tex';
import { MembersDialog, SettingsDialog } from '@/components/dashboard/workspace-dialogs';

// Messages for problems the Slack and GitHub install flows report on their way back here
const RETURN_ERRORS: Record<string, string> = {
  slack_expired: 'Adding Taro to Slack took too long. Try again.',
  slack_denied: 'Adding Taro to Slack was cancelled.',
  slack_missing_code: "Slack didn't finish adding Taro. Try again.",
  slack_failed: "Slack didn't finish adding Taro. Try again.",
  slack_team_mismatch: 'Taro was added to a different Slack workspace than the one you signed in with. Add it to this one instead.',
  workspace_not_found: 'That workspace no longer exists.',
  github_expired: 'Connecting GitHub took too long. Try again.',
  github_unverified: "This Taro server can't verify GitHub installations yet. Ask whoever runs it to finish the GitHub app setup.",
  github_needs_authorization: "GitHub didn't confirm your account. Ask whoever runs this Taro server to turn on user authorization for the GitHub app.",
  github_not_yours: "That GitHub installation isn't one your account can access.",
  github_no_installations: "The Taro app isn't installed on any GitHub account you can access yet. Install it first.",
  github_no_push_access:
    "Your GitHub account can't push to any repository the Taro app has access to. Grant Taro a repository you can push to, then connect again.",
  github_failed: "GitHub didn't finish connecting. Try again.",
};



function Dashboard() {
  const router = useRouter();
  const params = useSearchParams();
  const [overview, setOverview] = useState<WorkspaceOverview | null>(null);
  const [meetings, setMeetings] = useState<Meeting[]>([]);
  const [meta, setMeta] = useState<ServerMeta | null>(null);
  const [loadError, setLoadError] = useState('');
  const [editing, setEditing] = useState<KeySlot | null>(null);
  const [showMembers, setShowMembers] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [githubChoices, setGithubChoices] = useState<{ token: string; choices: GithubAccountChoice[] } | null>(null);
  const [finishing, setFinishing] = useState(false);

  const handleError = useCallback(
    (error: unknown) => {
      if (isSessionError(error)) {
        clearToken();
        router.replace('/signin?error=session');
        return true;
      }
      return false;
    },
    [router]
  );

  const loadOverview = useCallback(async () => {
    try {
      setOverview(await api.workspace.overview());
      setLoadError('');
    } catch (error) {
      if (!handleError(error)) setLoadError(error instanceof ApiError ? error.message : 'Could not load your workspace.');
    }
  }, [handleError]);

  const loadMeetings = useCallback(async () => {
    try {
      setMeetings((await api.meetings.list()).meetings);
    } catch (error) {
      handleError(error);
    }
  }, [handleError]);

  useEffect(() => {
    if (!getToken()) {
      router.replace('/signin');
      return;
    }
    loadOverview();
    loadMeetings();
    api.meta().then(setMeta).catch(() => {});
  }, [router, loadOverview, loadMeetings]);

  // Results of the Slack and GitHub install flows arrive as query params; show them once.
  const handledParams = useRef(false);
  useEffect(() => {
    if (handledParams.current) return;
    handledParams.current = true;
    const slack = params.get('slack');
    const github = params.get('github');
    const error = params.get('error');
    const githubConnect = params.get('githubConnect');
    if (slack === 'connected') showToast('Taro is in your Slack');
    if (github === 'connected') showToast('GitHub connected');
    if (error) showToast(RETURN_ERRORS[error] ?? "That didn't finish. Try again.", 'error');
    if (githubConnect) {
      // GitHub verified the account; connecting needs this session, so it happens here, not in the callback.
      api.github
        .connect(githubConnect)
        .then((res) => {
          if (res.connected) {
            showToast('GitHub connected');
            loadOverview();
          } else if (res.choices?.length) {
            setGithubChoices({ token: githubConnect, choices: res.choices });
          }
        })
        .catch((err) => {
          if (!handleError(err)) showToast(err instanceof ApiError ? err.message : 'Could not connect GitHub.', 'error');
        });
    }
    if (slack || github || error || githubConnect) router.replace('/dashboard');
  }, [params, router, loadOverview, handleError]);

  // Poll fast only while a meeting is live, and not at all in a hidden tab.
  const hasLive = meetings.some((m) => ACTIVE_STATUSES.has(m.status));
  useEffect(() => {
    const timer = setInterval(
      () => {
        if (document.visibilityState === 'visible') loadMeetings();
      },
      hasLive ? 4000 : 30000
    );
    const onVisible = () => {
      if (document.visibilityState === 'visible') {
        loadMeetings();
        loadOverview();
      }
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [hasLive, loadMeetings, loadOverview]);

  const redirectTo = async (getUrl: () => Promise<{ url: string }>, fallback: string) => {
    try {
      window.location.href = (await getUrl()).url;
    } catch (error) {
      if (!handleError(error)) showToast(error instanceof ApiError ? error.message : fallback, 'error');
    }
  };

  const signOut = async () => {
    await api.auth.logout().catch(() => {});
    clearToken();
    router.replace('/');
  };

  const finishSetup = async () => {
    setFinishing(true);
    try {
      const { workspace } = await api.workspace.completeOnboarding();
      setOverview((o) => (o ? { ...o, workspace } : o));
      showToast("You're all set. Send Taro to your next meeting.");
    } catch (error) {
      if (!handleError(error)) showToast(error instanceof ApiError ? error.message : 'Could not finish setup', 'error');
    } finally {
      setFinishing(false);
    }
  };

  if (!overview) {
    return (
      <main className="flex min-h-screen flex-col items-center justify-center gap-5 px-4">
        <Wordmark />
        {loadError ? (
          <div className="max-w-sm text-center">
            <p className="text-ink-2">{loadError}</p>
            <Button size="sm" className="mt-4" onClick={loadOverview}>
              Try again
            </Button>
          </div>
        ) : (
          <p className="text-ash">Loading your workspace…</p>
        )}
      </main>
    );
  }

  const { workspace, me, providers, ready } = overview;
  const canEdit = me.role !== 'member';
  const missing = [
    !ready.meetingBot && 'a MeetingBaas key',
    !ready.llm && 'an AI model',
    !ready.stt && 'transcription',
  ].filter(Boolean) as string[];

  return (
    <div className="min-h-screen">
      <DashboardHeader
        workspace={workspace}
        me={me}
        onMembers={() => setShowMembers(true)}
        onSettings={() => setShowSettings(true)}
        onSignOut={signOut}
      />

      <main id="main" className="sm:px-5">
        <div className="paper mx-auto max-w-page px-5 pb-14 pt-10 sm:rounded-[2px] sm:px-12 sm:shadow-page md:px-[88px] md:pt-14">
          <header className="text-center">
            <h1 className="font-title text-[clamp(1.9rem,1.5rem+1.6vw,2.6rem)] leading-tight">{workspace.name}</h1>
            <p className="mt-1 text-ink-2">
              A Taro workspace
              {workspace.slackTeamDomain && <span className="font-mono text-[0.88em] text-ash"> {workspace.slackTeamDomain}.slack.com</span>}
            </p>
          </header>

          {/* Also shown while unclaimed: adding Taro to Slack is how a workspace gets its owner */}
          {(!workspace.onboardedAt || !workspace.claimed) && (
            <Section n={0} title="Setup" id="setup" className="mt-10 md:mt-12">
              <SetupGuide
                overview={overview}
                canEdit={canEdit}
                finishing={finishing}
                onOpenKey={setEditing}
                onAddSlack={() => redirectTo(() => api.slack.installUrl(), 'Could not start the Slack install')}
                onInstallGithub={() => redirectTo(() => api.github.installUrl('install'), 'Could not start the GitHub install')}
                onFinish={finishSetup}
              />
            </Section>
          )}

          <Section n={1} title="Meetings" id="meetings" className="mt-10 md:mt-12">
            <div className="space-y-6">
              <SendToMeeting canJoin={ready.canJoinMeetings} missing={missing} onSent={loadMeetings} />
              <MeetingsSection meetings={meetings} onChanged={loadMeetings} />
            </div>
          </Section>

          <Section n={2} title="Your keys" id="keys">
            <KeysSection
              providers={providers}
              canEdit={canEdit}
              serverStt={!!meta?.serverStt}
              editing={editing}
              setEditing={setEditing}
              onUpdated={(next) => {
                setOverview((o) => (o ? { ...o, providers: next } : o));
                // Readiness flags are computed server-side from the providers
                loadOverview();
              }}
            />
            <p className="mt-3 text-sm text-ash">Keys are checked with the provider, encrypted, and never shown again.</p>
          </Section>

          <Section n={3} title="Connections" id="connections">
            <ConnectionsSection
              slack={overview.slack}
              github={overview.github}
              canEdit={canEdit}
              canAddSlack={canEdit || !workspace.claimed}
              githubChoices={githubChoices}
              onChoicesDone={() => setGithubChoices(null)}
              onChanged={loadOverview}
            />
          </Section>
        </div>
        <p className="py-8 text-center text-sm text-ash">In a meeting, say “Hey Taro” and then your request.</p>
      </main>

      <MembersDialog open={showMembers} me={me} onClose={() => setShowMembers(false)} />
      <SettingsDialog
        open={showSettings}
        workspace={workspace}
        me={me}
        onClose={() => setShowSettings(false)}
        onSaved={(w) => setOverview((o) => (o ? { ...o, workspace: w } : o))}
        onDeleted={() => {
          clearToken();
          router.replace('/');
        }}
      />
    </div>
  );
}

export default function DashboardPage() {
  return (
    <Suspense
      fallback={
        <main className="flex min-h-screen items-center justify-center">
          <Wordmark />
        </main>
      }
    >
      <Dashboard />
    </Suspense>
  );
}
