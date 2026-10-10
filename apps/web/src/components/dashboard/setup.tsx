'use client';

// The Setup view (9.5): the required set in its one order (Slack, meeting bot, AI model,
// transcription), then the optional connections. Slack is required only in Slack workspaces;
// Google workspaces find it first under Optional. Google Calendar is each person's own, so every
// member can connect theirs. Rows and cards are exported so the demo can build its read-only
// version from the same pieces.

import * as React from 'react';
import Link from 'next/link';
import {
  GITHUB_CAPABILITIES,
  TICKET_CAPABILITIES,
  TRACKERS,
  getLlmProvider,
  getSttProvider,
  type ConnectedSession,
  type GoogleCalendarJoinMode,
  type GoogleCalendarStatus,
  type ProviderSettings,
  type ServerMeta,
  type TrackerId,
  type TrackerStatus,
  type WorkspaceOverview,
} from '@taro/shared';
import { api, ApiError } from '@/lib/api';
import { daysBefore, timeAgo } from '@/lib/format';
import { setupSteps, slackRequired, type SetupStepId } from '@/lib/meeting-state';
import { cn } from '@/lib/utils';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { CardHeader, CardTitle } from '@/components/ui/card';
import { Select } from '@/components/ui/select';
import { SwitchRow } from '@/components/ui/switch';
import { Time } from '@/components/ui/time';
import { showToast } from '@/components/ui/toast-store';
import { errorText, focusIfLost, useSessionGuard } from './common';
import { DisconnectGithubDialog, PermissionsDialog } from './github-dialogs';
import { DisconnectTrackerDialog, JiraKeyDialog, TicketPermissionsDialog } from './tracker-dialogs';
import { KeyDialogs, type KeySlot } from './key-dialogs';
import { ROW_BUTTON } from './styles';
import { ConfirmDialog, RemoveSlackDialog } from './workspace-dialogs';
import { WebhooksRow } from './webhook-dialogs';

// ---------------------------------------------------------------------------------------------
// Pieces

/** One setup row: the label, the state and its purpose, and the actions. `next` marks the first unfinished step. */
export function SetupRow({
  id,
  label,
  state,
  stateTone = 'ink',
  purpose,
  meta,
  actions,
  stackActions = false,
  next = false,
  children,
}: {
  id?: string;
  label: string;
  state?: React.ReactNode;
  // Taro purple only for "Not set up"
  stateTone?: 'ink' | 'taro';
  purpose?: React.ReactNode;
  meta?: React.ReactNode;
  actions?: React.ReactNode;
  // Two long actions stack from 768px instead of crowding the text beside them
  stackActions?: boolean;
  next?: boolean;
  children?: React.ReactNode;
}) {
  return (
    <li
      id={id}
      className={cn(
        'grid gap-3 border-b border-rule-soft px-5 py-[18px] last:border-b-0 md:grid-cols-[150px_minmax(0,1fr)_auto] md:items-start md:gap-x-5 md:px-6',
        next && 'border-l-[3px] border-l-taro bg-poi pl-[17px] md:pl-[21px]'
      )}
    >
      <h3 className="text-sm font-semibold text-ash md:pt-0.5">{label}</h3>
      <div className="min-w-0">
        {state && <p className={cn('text-base font-650', stateTone === 'taro' ? 'text-taro' : 'text-ink')}>{state}</p>}
        {purpose && <div className="mt-0.5 text-sm text-ink-2">{purpose}</div>}
        {meta && <p className="mt-1 text-meta text-ash">{meta}</p>}
        {children}
      </div>
      {actions && (
        <div className={cn('flex flex-wrap gap-2 md:justify-end md:pt-0.5', stackActions && 'md:flex-col md:flex-nowrap md:items-end')}>{actions}</div>
      )}
    </li>
  );
}

/** A setup card: a titled panel holding rows, with an optional note on the right of its header and a footer line. */
export function SetupCard({
  id,
  title,
  aside,
  footer,
  className,
  children,
}: {
  id: string;
  title: string;
  aside?: React.ReactNode;
  footer?: React.ReactNode;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <section aria-labelledby={id} className={cn('overflow-hidden rounded-card border border-rule bg-paper', className)}>
      <CardHeader>
        <CardTitle id={id}>{title}</CardTitle>
        {aside && <p className="text-meta text-ash">{aside}</p>}
      </CardHeader>
      <ul className="list-none">{children}</ul>
      {footer && <p className="border-t border-rule-soft px-5 py-3 text-meta text-ash md:px-6">{footer}</p>}
    </section>
  );
}

const Mono = ({ children }: { children: React.ReactNode }) => <span className="font-mono text-[0.88em]">{children}</span>;

/** "gsk_…C3dz · checked 18 min ago" */
function keyMeta(hint?: string, checkedAt?: string): React.ReactNode {
  if (!hint && !checkedAt) return null;
  return (
    <>
      {hint && <Mono>{hint}</Mono>}
      {hint && checkedAt ? ' · ' : null}
      {checkedAt && `checked ${timeAgo(checkedAt)}`}
    </>
  );
}

// Leaving for Slack or GitHub. A page restored with Back starts usable again.
function useLeaving(): [string | null, (what: string | null) => void] {
  const [leaving, setLeaving] = React.useState<string | null>(null);
  React.useEffect(() => {
    const onShow = (e: PageTransitionEvent) => {
      if (e.persisted) setLeaving(null);
    };
    window.addEventListener('pageshow', onShow);
    return () => window.removeEventListener('pageshow', onShow);
  }, []);
  return [leaving, setLeaving];
}

// ---------------------------------------------------------------------------------------------
// The view

export function SetupView({
  overview,
  meta,
  onProviders,
  onChanged,
  openPermissions = false,
  onPermissionsClosed,
  onGoToMeetings,
}: {
  overview: WorkspaceOverview;
  meta: ServerMeta | null;
  // A key dialog saved; the readiness flags come from the server, so the caller reloads too
  onProviders: (providers: ProviderSettings) => void;
  // Anything else changed on the server
  onChanged: () => void;
  // ?open=permissions
  openPermissions?: boolean;
  onPermissionsClosed?: () => void;
  onGoToMeetings?: () => void;
}) {
  const guard = useSessionGuard();
  const { workspace, me, providers, slack, github } = overview;
  const canEdit = me.role !== 'member';
  const claimed = workspace.claimed;
  const slackIsRequired = slackRequired(workspace);
  const { steps, todo, next } = setupSteps(overview);
  const done = (id: SetupStepId) => steps.find((s) => s.id === id)?.done ?? false;

  const [editing, setEditing] = React.useState<KeySlot | null>(null);
  const [confirm, setConfirm] = React.useState<'slack' | 'github' | null>(null);
  const [permsOpen, setPermsOpen] = React.useState(false);
  const [ticketPerms, setTicketPerms] = React.useState<TrackerId | null>(null);
  const [disconnectTracker, setDisconnectTracker] = React.useState<TrackerId | null>(null);
  const [jiraKeyOpen, setJiraKeyOpen] = React.useState(false);
  const [leaving, setLeaving] = useLeaving();
  const [reconnecting, setReconnecting] = React.useState(false);

  React.useEffect(() => {
    if (openPermissions && github.connected) setPermsOpen(true);
  }, [openPermissions, github.connected]);

  // Removing Slack or disconnecting GitHub replaces the row's buttons; focus moves to the new one once it shows.
  const refocusRow = React.useRef<'slack' | 'github' | null>(null);
  React.useEffect(() => {
    const row = refocusRow.current;
    if (!row || (row === 'slack' ? slack.connected : github.connected)) return;
    refocusRow.current = null;
    document.querySelector<HTMLElement>(`#setup-${row} button, #setup-${row} a`)?.focus();
  }, [slack.connected, github.connected]);

  const fail = (error: unknown, fallback: string) => {
    if (!guard(error)) showToast(errorText(error, fallback), 'error');
  };

  const leaveFor = async (what: string, getUrl: () => Promise<{ url: string }>, fallback: string) => {
    setLeaving(what);
    try {
      const { url } = await getUrl();
      if (!url) throw new Error('No address to go to');
      window.location.href = url;
    } catch (error) {
      setLeaving(null);
      fail(error, fallback);
    }
  };

  const addToSlack = () => leaveFor('slack', () => api.slack.installUrl(), "Couldn't start adding Taro to Slack.");

  const reconnectGithub = async () => {
    setReconnecting(true);
    try {
      await api.github.reconnect();
      showToast('GitHub reconnected.');
      onChanged();
    } catch (error) {
      if (error instanceof ApiError && error.code === 'INSTALL_NEEDED') {
        await leaveFor('github', () => api.github.installUrl('install'), "Couldn't start the GitHub install.");
      } else {
        fail(error, "Couldn't reconnect GitHub.");
      }
    } finally {
      setReconnecting(false);
    }
  };

  // Slack: anyone can add Taro while nobody owns the workspace; that's how it gets its owner.
  const slackActionsFor = (): React.ReactNode => {
    if (slack.connected && claimed) {
      return canEdit ? (
        <Button variant="destructive" size="sm" className={ROW_BUTTON} onClick={() => setConfirm('slack')}>
          Remove
        </Button>
      ) : null;
    }
    if (!claimed || canEdit) {
      return (
        <Button size="sm" className={ROW_BUTTON} onClick={addToSlack} pending={leaving === 'slack'}>
          {leaving === 'slack' ? 'Opening Slack' : slack.connected ? 'Add again' : 'Add to Slack'}
        </Button>
      );
    }
    return null;
  };

  const keyAction = (slot: KeySlot, ready: boolean, readyLabel: string, missingLabel: string) =>
    canEdit ? (
      <Button variant={ready ? 'secondary' : 'primary'} size="sm" className={ROW_BUTTON} onClick={() => setEditing(slot)}>
        {ready ? readyLabel : missingLabel}
      </Button>
    ) : null;

  const llm = getLlmProvider(providers.llm.provider);
  const llmModel = llm?.models.find((m) => m.id === providers.llm.model)?.label;
  const stt = getSttProvider(providers.stt.provider);
  // Not set up by the workspace, so running on the server's shared Groq key
  const llmShared = !providers.llm.configured && !!providers.llm.shared;
  const sttShared = !providers.stt.configured && !!providers.stt.shared;
  const free = providers.free;
  const freeMeta = free
    ? `${Math.min(free.usedThisMonth, free.meetingsPerMonth)} of ${free.meetingsPerMonth} free meetings used this month. Add your own key for no limit.`
    : null;

  const requiredFooter = canEdit ? null : claimed ? 'Owners and admins can change these.' : 'The owner adds the keys once Taro is in Slack.';

  return (
    <div className="mx-auto max-w-setup">
      <h1 id="setup-title" tabIndex={-1} className="text-h1-app font-750 text-ink">
        Setup
      </h1>
      <p className="mt-2 max-w-[60ch] text-ui leading-[1.55] text-ink-2">
        Taro runs on your own accounts. Add these once and anyone in {workspace.name} can send Taro to a meeting. Keys are
        checked with the provider, encrypted, and never shown again.
      </p>
      {!claimed && (
        <Alert tone="info" className="mt-6">
          Nobody owns this workspace yet. Whoever adds Taro to Slack becomes the owner.
        </Alert>
      )}

      <SetupCard id="required-title" title="Required" aside={todo ? `${todo} to finish` : 'All set'} footer={requiredFooter} className="mt-6">
        {!slackIsRequired ? null : slack.connected && claimed ? (
          <SetupRow
            id="setup-slack"
            label="Slack"
            state={`In ${slack.teamName ?? workspace.name}`}
            purpose="Taro watches public channels for meeting links and replies in the thread."
            actions={slackActionsFor()}
            next={next === 'slack'}
          />
        ) : slack.connected ? (
          <SetupRow
            id="setup-slack"
            label="Slack"
            state={`In ${slack.teamName ?? workspace.name}, no owner yet`}
            purpose="Add Taro to Slack again to become this workspace's owner. Slack owners and admins also become owners when they sign in."
            actions={slackActionsFor()}
            next={next === 'slack'}
          />
        ) : (
          <SetupRow
            id="setup-slack"
            label="Slack"
            state="Not set up"
            stateTone="taro"
            purpose={
              claimed
                ? 'Add Taro to Slack so it can find meeting links and post what it did.'
                : "Add Taro to Slack so it can find meeting links and post what it did. Whoever adds it becomes this workspace's owner."
            }
            actions={slackActionsFor()}
            next={next === 'slack'}
          />
        )}

        {done('meetingBot') ? (
          <SetupRow
            label="Meeting bot"
            state="MeetingBaas"
            purpose="Joins your calls as a guest and streams the audio to Taro."
            meta={keyMeta(providers.meetingBot.keyHint, providers.meetingBot.validatedAt)}
            actions={keyAction('meetingBot', true, 'Replace key', 'Add key')}
            next={next === 'meetingBot'}
          />
        ) : (
          <SetupRow
            label="Meeting bot"
            state="Not set up"
            stateTone="taro"
            purpose="MeetingBaas joins your calls as a guest and streams the audio to Taro."
            actions={keyAction('meetingBot', false, 'Replace key', 'Add key')}
            next={next === 'meetingBot'}
          />
        )}

        <SetupRow
          label="AI model"
          state={
            llmShared ? (
              'Free Groq key from Taro'
            ) : done('llm') ? (
              <>
                {llm?.name ?? 'Custom'}, {llmModel ?? <Mono>{providers.llm.model}</Mono>}
              </>
            ) : (
              'Not set up'
            )
          }
          stateTone={done('llm') ? 'ink' : 'taro'}
          purpose="Works out what people asked for and writes the issue, message, or pull request."
          meta={
            llmShared ? (
              freeMeta
            ) : done('llm') ? (
              <>
                {providers.llm.baseUrl && (
                  <>
                    <span className="font-mono text-[0.88em] wrap-anywhere">{providers.llm.baseUrl}</span>
                    {' · '}
                  </>
                )}
                {keyMeta(providers.llm.keyHint, providers.llm.validatedAt)}
              </>
            ) : null
          }
          actions={keyAction('llm', done('llm'), llmShared ? 'Use your own key' : 'Change model', 'Choose model')}
          next={next === 'llm'}
        />

        <SetupRow
          label="Transcription"
          state={sttShared ? 'Free Groq key from Taro' : done('stt') ? stt?.name ?? 'Set up' : 'Not set up'}
          stateTone={done('stt') ? 'ink' : 'taro'}
          purpose="Turns speech into text as people talk."
          meta={
            sttShared
              ? freeMeta
              : !done('stt')
                ? null
                : providers.stt.provider === 'server'
                  ? 'Hosted by this server'
                  : providers.stt.usesLlmKey
                    ? 'Uses your AI model key'
                    : keyMeta(providers.stt.keyHint, providers.stt.validatedAt)
          }
          actions={keyAction('stt', done('stt'), sttShared ? 'Use your own key' : 'Change', 'Set up')}
          next={next === 'stt'}
        />
      </SetupCard>

      {todo === 0 && (
        <div className="mt-5 flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
          <p className="text-ui text-ink">Everything Taro needs is set up.</p>
          <Button asChild size="sm" className={ROW_BUTTON}>
            <Link href="/dashboard?view=meetings" scroll={false} onClick={onGoToMeetings}>
              Go to Meetings
            </Link>
          </Button>
        </div>
      )}

      <SetupCard id="optional-title" title="Optional" className="mt-5">
        {!slackIsRequired &&
          (meta && !meta.slackSignIn && !slack.connected ? (
            <SetupRow id="setup-slack" label="Slack" purpose="Slack isn't set up on this Taro server." />
          ) : (
            <SetupRow
              id="setup-slack"
              label="Slack"
              state={slack.connected ? `In ${slack.teamName ?? 'Slack'}` : 'Not connected'}
              purpose={
                slack.connected
                  ? 'Taro watches public channels for meeting links and replies in the thread.'
                  : 'Add Taro to Slack to hear meeting links in channels and post updates.'
              }
              actions={slackActionsFor()}
            />
          ))}
        {overview.googleCalendar && (meta?.googleCalendar || overview.googleCalendar.connected) && (
          <GoogleCalendarRow
            calendar={overview.googleCalendar}
            workspaceName={workspace.name}
            leaving={leaving}
            onConnect={() => leaveFor('google-calendar', () => api.googleCalendar.connectUrl(), "Couldn't reach Google.")}
            onChanged={onChanged}
          />
        )}
        <GithubRow
          overview={overview}
          canEdit={canEdit}
          leaving={leaving}
          reconnecting={reconnecting}
          onInstall={() => leaveFor('github', () => api.github.installUrl('install'), "Couldn't start the GitHub install.")}
          onConnect={() => leaveFor('github-connect', () => api.github.installUrl('connect'), "Couldn't reach GitHub.")}
          onReconnect={reconnectGithub}
          onPermissions={() => setPermsOpen(true)}
          onDisconnect={() => setConfirm('github')}
          onChanged={onChanged}
        />
        {(['linear', 'jira'] as const).map((id) =>
          overview[id].connected || meta?.[id] ? (
            <TrackerRow
              key={id}
              id={id}
              status={overview[id]}
              canEdit={canEdit}
              leaving={leaving}
              onConnect={() =>
                id === 'linear'
                  ? leaveFor('linear', () => api.linear.connectUrl(), "Couldn't reach Linear.")
                  : setJiraKeyOpen(true)
              }
              onPermissions={() => setTicketPerms(id)}
              onDisconnect={() => setDisconnectTracker(id)}
              onChanged={onChanged}
            />
          ) : null
        )}
        {overview.linear.connected && overview.jira.connected && (
          <TicketsRow chosen={overview.ticketTracker} canEdit={canEdit} onChanged={onChanged} />
        )}
        {meta?.meetExtension && <MeetButtonRow canEdit={canEdit} />}
        {meta?.calendarInvites && <CalendarRow canEdit={canEdit} />}
        {canEdit && claimed && <WebhooksRow />}
      </SetupCard>

      <KeyDialogs
        editing={editing}
        providers={providers}
        serverStt={!!meta?.serverStt}
        onClose={() => setEditing(null)}
        onSaved={(next) => {
          setEditing(null);
          onProviders(next);
        }}
      />
      <RemoveSlackDialog
        open={confirm === 'slack'}
        onClose={() => setConfirm(null)}
        onDone={() => {
          refocusRow.current = 'slack';
          setConfirm(null);
          onChanged();
        }}
      />
      <DisconnectGithubDialog
        open={confirm === 'github'}
        onClose={() => setConfirm(null)}
        onDone={() => {
          refocusRow.current = 'github';
          setConfirm(null);
          onChanged();
        }}
      />
      <TicketPermissionsDialog
        tracker={ticketPerms && overview[ticketPerms].connected ? ticketPerms : null}
        enabled={(ticketPerms && overview[ticketPerms].enabledActions) || []}
        readOnly={!canEdit}
        onClose={() => {
          setTicketPerms(null);
          focusIfLost('setup-title');
        }}
        onSaved={onChanged}
      />
      <DisconnectTrackerDialog
        tracker={disconnectTracker}
        onClose={() => setDisconnectTracker(null)}
        onDone={() => {
          setDisconnectTracker(null);
          onChanged();
          focusIfLost('setup-title');
        }}
      />
      <JiraKeyDialog open={jiraKeyOpen} jira={overview.jira} onClose={() => setJiraKeyOpen(false)} onConnected={onChanged} />
      <PermissionsDialog
        open={permsOpen && github.connected}
        enabled={github.enabledActions ?? []}
        readOnly={!canEdit}
        onClose={() => {
          setPermsOpen(false);
          onPermissionsClosed?.();
          focusIfLost('setup-title');
        }}
        onSaved={onChanged}
      />
    </div>
  );
}

// ---------------------------------------------------------------------------------------------
// GitHub

function GithubRow({
  overview,
  canEdit,
  leaving,
  reconnecting,
  onInstall,
  onConnect,
  onReconnect,
  onPermissions,
  onDisconnect,
  onChanged,
}: {
  overview: WorkspaceOverview;
  canEdit: boolean;
  leaving: string | null;
  reconnecting: boolean;
  onInstall: () => void;
  onConnect: () => void;
  onReconnect: () => void;
  onPermissions: () => void;
  onDisconnect: () => void;
  onChanged: () => void;
}) {
  const { github } = overview;
  const guard = useSessionGuard();
  const [repos, setRepos] = React.useState<string[] | null>(null);
  const [reposError, setReposError] = React.useState<string | null>(null);
  const [reposAttempt, setReposAttempt] = React.useState(0);
  const [savingRepo, setSavingRepo] = React.useState(false);

  React.useEffect(() => {
    setReposError(null);
    if (!github.connected || !canEdit) {
      setRepos(null);
      return;
    }
    let cancelled = false;
    api.github
      .repos()
      .then(({ repos }) => !cancelled && setRepos(repos))
      .catch((error) => {
        if (cancelled || guard(error)) return;
        setRepos(null);
        setReposError(errorText(error, "Couldn't load your repositories."));
      });
    return () => {
      cancelled = true;
    };
  }, [github.connected, github.accountLogin, canEdit, guard, reposAttempt]);

  const chooseRepo = async (repo: string) => {
    setSavingRepo(true);
    try {
      await api.github.setRepo(repo);
      showToast(`Taro works in ${repo} now.`);
      onChanged();
    } catch (error) {
      if (!guard(error)) showToast(errorText(error, "Couldn't save the repository."), 'error');
    } finally {
      setSavingRepo(false);
      focusIfLost('github-repo');
    }
  };

  if (!github.configured) {
    return <SetupRow id="setup-github" label="GitHub" purpose="GitHub isn't set up on this Taro server." />;
  }

  if (github.connected) {
    const on = github.enabledActions?.length ?? 0;
    const choosing = canEdit && !!repos && repos.length > 0 && (github.needsRepo || !github.repo || repos.length > 1);
    const working = choosing ? (
      <span className="flex flex-wrap items-center gap-x-2 gap-y-1.5">
        <label htmlFor="github-repo">Working in</label>
        <Select
          id="github-repo"
          value={github.repo && repos.includes(github.repo) ? github.repo : ''}
          disabled={savingRepo}
          onChange={(e) => e.target.value && chooseRepo(e.target.value)}
          wrapperClassName="w-full max-w-[240px]"
          className="font-mono text-[14px]"
        >
          {!(github.repo && repos.includes(github.repo)) && (
            <option value="" disabled>
              Choose a repository
            </option>
          )}
          {repos.map((repo) => (
            <option key={repo} value={repo}>
              {repo}
            </option>
          ))}
        </Select>
      </span>
    ) : github.repo ? (
      <>
        Working in <span className="font-mono text-[0.88em] wrap-anywhere">{github.repo}</span>
      </>
    ) : null;
    return (
      <SetupRow
        id="setup-github"
        label="GitHub"
        state={`Installed on ${github.accountLogin ?? 'GitHub'}`}
        purpose={
          github.needsRepo ? (
            <>
              {working}
              {canEdit && reposError ? (
                <Alert tone="error" className={working ? 'mt-3' : undefined}>
                  <p>{reposError}</p>
                  <Button variant="secondary" size="sm" className="mt-3" onClick={() => setReposAttempt((n) => n + 1)}>
                    Try again
                  </Button>
                </Alert>
              ) : canEdit && repos?.length === 0 ? (
                <Alert tone="info" className={working ? 'mt-3' : undefined}>
                  <p>The Taro app can&apos;t reach a repository you can push to. Give it access to one on GitHub, then come back here.</p>
                  <Button variant="secondary" size="sm" className="mt-3" onClick={onInstall} pending={leaving === 'github'} disabled={!!leaving}>
                    Choose repositories on GitHub
                  </Button>
                </Alert>
              ) : (
                <Alert tone="info" className={working ? 'mt-3' : undefined}>
                  {canEdit ? 'Choose the repository Taro works in.' : 'An owner or admin chooses the repository Taro works in.'}
                </Alert>
              )}
            </>
          ) : (
            working
          )
        }
        meta={`${on} of ${GITHUB_CAPABILITIES.length} on`}
        actions={
          canEdit ? (
            <>
              <Button variant="secondary" size="sm" className={ROW_BUTTON} onClick={onPermissions}>
                Permissions
              </Button>
              <Button variant="destructive" size="sm" className={ROW_BUTTON} onClick={onDisconnect}>
                Disconnect
              </Button>
            </>
          ) : (
            <Button variant="link" size="sm" onClick={onPermissions}>
              View permissions
            </Button>
          )
        }
      />
    );
  }

  if (github.reconnectable) {
    return (
      <SetupRow
        id="setup-github"
        label="GitHub"
        state="Disconnected"
        purpose="Reconnect in one click. The app is still installed on GitHub."
        actions={
          canEdit ? (
            <Button size="sm" className={ROW_BUTTON} onClick={onReconnect} pending={reconnecting || leaving === 'github'}>
              {reconnecting || leaving === 'github' ? 'Reconnecting' : 'Reconnect GitHub'}
            </Button>
          ) : null
        }
      />
    );
  }

  return (
    <SetupRow
      id="setup-github"
      label="GitHub"
      state="Not connected"
      purpose="Lets Taro file issues and open pull requests as its own bot, never as you."
      stackActions
      actions={
        canEdit ? (
          <>
            <Button variant="secondary" size="sm" className={ROW_BUTTON} onClick={onInstall} pending={leaving === 'github'} disabled={!!leaving}>
              {leaving === 'github' ? 'Opening GitHub' : 'Install the GitHub app'}
            </Button>
            <Button variant="ghost" size="sm" className={ROW_BUTTON} onClick={onConnect} pending={leaving === 'github-connect'} disabled={!!leaving}>
              {leaving === 'github-connect' ? 'Opening GitHub' : 'Already installed? Connect it'}
            </Button>
          </>
        ) : null
      }
    />
  );
}

// ---------------------------------------------------------------------------------------------
// Linear and Jira

const SPACE_WORD: Record<TrackerId, { one: string; many: string }> = {
  linear: { one: 'team', many: 'teams' },
  jira: { one: 'project', many: 'projects' },
};

/**
 * Linear or Jira, shared by the workspace. Connected, it says where new tickets go, which owners and
 * admins can change. When the tracker stops accepting Taro, the row asks for a reconnect.
 */
function TrackerRow({
  id,
  status,
  canEdit,
  leaving,
  onConnect,
  onPermissions,
  onDisconnect,
  onChanged,
}: {
  id: TrackerId;
  status: TrackerStatus;
  canEdit: boolean;
  leaving: string | null;
  onConnect: () => void;
  onPermissions: () => void;
  onDisconnect: () => void;
  onChanged: () => void;
}) {
  const guard = useSessionGuard();
  const name = TRACKERS[id];
  const word = SPACE_WORD[id];
  const [saving, setSaving] = React.useState(false);
  const [reloading, setReloading] = React.useState(false);
  const selectId = `${id}-space`;

  const choose = async (space: string) => {
    setSaving(true);
    try {
      const next = id === 'linear' ? (await api.linear.setTeam(space)).linear : (await api.jira.setProject(space)).jira;
      const chosen = next.spaces?.find((s) => s.id === next.defaultSpace);
      showToast(chosen ? `New ${name} tickets go to ${chosen.name} now.` : 'Saved.');
      onChanged();
    } catch (error) {
      if (!guard(error)) showToast(errorText(error, `Couldn't save the ${word.one}.`), 'error');
    } finally {
      setSaving(false);
      focusIfLost(selectId);
    }
  };

  const reload = async () => {
    setReloading(true);
    try {
      await (id === 'linear' ? api.linear.refresh() : api.jira.refresh());
      showToast(`${name} ${word.many} reloaded.`);
      onChanged();
    } catch (error) {
      if (!guard(error)) showToast(errorText(error, `Couldn't reload your ${word.many}.`), 'error');
    } finally {
      setReloading(false);
    }
  };

  if (!status.connected) {
    return (
      <SetupRow
        id={`setup-${id}`}
        label={name}
        state="Not connected"
        purpose={`Lets Taro file and update ${name} tickets as its own app, never as you.`}
        actions={
          canEdit ? (
            <Button size="sm" className={ROW_BUTTON} onClick={onConnect} pending={leaving === id} disabled={!!leaving}>
              {leaving === id ? `Opening ${name}` : `Connect ${name}`}
            </Button>
          ) : null
        }
      />
    );
  }

  const spaces = status.spaces ?? [];
  const chosen = spaces.find((s) => s.id === status.defaultSpace);
  const on = status.enabledActions?.length ?? 0;
  const where = canEdit && spaces.length > 0 && (!chosen || spaces.length > 1) ? (
    <span className="flex flex-wrap items-center gap-x-2 gap-y-1.5">
      <label htmlFor={selectId}>New tickets go to</label>
      <Select
        id={selectId}
        value={chosen?.id ?? ''}
        disabled={saving}
        onChange={(e) => e.target.value && choose(e.target.value)}
        wrapperClassName="w-full max-w-[240px]"
      >
        {!chosen && (
          <option value="" disabled>
            Choose a {word.one}
          </option>
        )}
        {spaces.map((s) => (
          <option key={s.id} value={s.id}>
            {s.name} ({s.key})
          </option>
        ))}
      </Select>
    </span>
  ) : chosen ? (
    <>
      New tickets go to {chosen.name} <span className="font-mono text-[0.88em]">{chosen.key}</span>
    </>
  ) : null;

  return (
    <SetupRow
      id={`setup-${id}`}
      label={name}
      state={status.siteName ? `In ${status.siteName}` : 'Connected'}
      purpose={
        <>
          {where}
          {status.needsReconnect ? (
            <Alert tone="error" className={where ? 'mt-3' : undefined}>
              <p>
                {id === 'linear'
                  ? 'Linear stopped accepting Taro’s access. Connect it again to keep filing tickets.'
                  : 'The Taro app for Jira refused the connection key. It was replaced or the app was removed. Paste a new key.'}
              </p>
              {canEdit && (
                <Button variant="secondary" size="sm" className="mt-3" onClick={onConnect} pending={leaving === id} disabled={!!leaving}>
                  {id === 'linear' ? 'Reconnect Linear' : 'Paste a new key'}
                </Button>
              )}
            </Alert>
          ) : spaces.length === 0 ? (
            <Alert tone="info" className={where ? 'mt-3' : undefined}>
              <p>
                Taro can&apos;t see any {name} {word.many} yet.{' '}
                {id === 'jira' ? 'Check that the Taro app has access to a project, then reload.' : 'Add one in Linear, then reload.'}
              </p>
              {canEdit && (
                <Button variant="secondary" size="sm" className="mt-3" onClick={reload} pending={reloading}>
                  Reload {word.many}
                </Button>
              )}
            </Alert>
          ) : !chosen ? (
            <Alert tone="info" className={where ? 'mt-3' : undefined}>
              {canEdit ? `Choose the ${word.one} new tickets go to.` : `An owner or admin chooses the ${word.one} new tickets go to.`}
            </Alert>
          ) : canEdit ? (
            <Button variant="link" size="sm" className="mt-1 block" onClick={reload} pending={reloading}>
              {reloading ? `Reloading ${word.many}` : `Missing a ${word.one}? Reload`}
            </Button>
          ) : null}
        </>
      }
      meta={`${on} of ${TICKET_CAPABILITIES.length} on`}
      actions={
        canEdit ? (
          <>
            <Button variant="secondary" size="sm" className={ROW_BUTTON} onClick={onPermissions}>
              Permissions
            </Button>
            <Button variant="destructive" size="sm" className={ROW_BUTTON} onClick={onDisconnect}>
              Disconnect
            </Button>
          </>
        ) : (
          <Button variant="link" size="sm" onClick={onPermissions}>
            View permissions
          </Button>
        )
      }
    />
  );
}

/** With Linear and Jira both connected: where a ticket goes when nobody says which. */
function TicketsRow({ chosen, canEdit, onChanged }: { chosen?: TrackerId; canEdit: boolean; onChanged: () => void }) {
  const guard = useSessionGuard();
  const [saving, setSaving] = React.useState(false);
  const pick = async (tracker: TrackerId) => {
    setSaving(true);
    try {
      await api.setTicketTracker(tracker);
      showToast(`Tickets go to ${TRACKERS[tracker]} unless someone names the other.`);
      onChanged();
    } catch (error) {
      if (!guard(error)) showToast(errorText(error, "Couldn't save that."), 'error');
    } finally {
      setSaving(false);
      focusIfLost('ticket-tracker');
    }
  };
  const current = chosen ?? 'linear';
  return (
    <SetupRow
      id="setup-tickets"
      label="Tickets"
      state="Linear and Jira"
      purpose={
        canEdit ? (
          <span className="flex flex-wrap items-center gap-x-2 gap-y-1.5">
            <label htmlFor="ticket-tracker">When nobody says which, tickets go to</label>
            <Select
              id="ticket-tracker"
              value={current}
              disabled={saving}
              onChange={(e) => pick(e.target.value as TrackerId)}
              wrapperClassName="w-full max-w-[160px]"
            >
              <option value="linear">Linear</option>
              <option value="jira">Jira</option>
            </Select>
          </span>
        ) : (
          `When nobody says which, tickets go to ${TRACKERS[current]}.`
        )
      }
      meta="Saying “in Jira” or “in Linear”, or a ticket key like ENG 12, picks one."
    />
  );
}

// ---------------------------------------------------------------------------------------------
// Google Calendar, each person's own

const JOIN_MODES: ReadonlyArray<{ value: GoogleCalendarJoinMode; label: string }> = [
  { value: 'all', label: "All meetings with a video link that I haven't declined" },
  { value: 'organizer', label: 'Only meetings I organize' },
];

/**
 * The signed-in person's own Google Calendar. Connected, Taro reads it, never changes it, and joins
 * the meetings on it with a video link, which the person can narrow to the ones they organize or
 * turn off. When Google stops honoring Taro's access, the row asks them to reconnect.
 */
function GoogleCalendarRow({
  calendar,
  workspaceName,
  leaving,
  onConnect,
  onChanged,
}: {
  calendar: GoogleCalendarStatus;
  workspaceName: string;
  leaving: string | null;
  onConnect: () => void;
  onChanged: () => void;
}) {
  const guard = useSessionGuard();
  const [saving, setSaving] = React.useState(false);
  const [confirming, setConfirming] = React.useState(false);
  // The choice shows at once while it saves; the overview catches up after.
  const [draft, setDraft] = React.useState<{ autoJoin: boolean; joinMode: GoogleCalendarJoinMode } | null>(null);
  React.useEffect(() => setDraft(null), [calendar.autoJoin, calendar.joinMode]);
  const autoJoin = draft?.autoJoin ?? calendar.autoJoin ?? true;
  const joinMode = draft?.joinMode ?? calendar.joinMode ?? 'all';
  const opening = leaving === 'google-calendar';

  // Disconnecting replaces the row's buttons; focus moves to the new one once it shows.
  const refocus = React.useRef(false);
  React.useEffect(() => {
    if (!refocus.current || calendar.connected) return;
    refocus.current = false;
    document.querySelector<HTMLElement>('#setup-google-calendar button')?.focus();
  }, [calendar.connected]);

  const save = async (changes: { autoJoin?: boolean; joinMode?: GoogleCalendarJoinMode }) => {
    setDraft({ autoJoin, joinMode, ...changes });
    setSaving(true);
    try {
      await api.googleCalendar.update(changes);
      showToast(
        changes.autoJoin === false
          ? "Taro won't join your calendar meetings on its own."
          : changes.autoJoin
            ? 'Taro joins your calendar meetings on its own.'
            : changes.joinMode === 'organizer'
              ? 'Taro joins only the meetings you organize.'
              : 'Taro joins all your meetings with a video link.'
      );
      onChanged();
    } catch (error) {
      setDraft(null);
      if (!guard(error)) showToast(errorText(error, "Couldn't save that. Try again."), 'error');
    } finally {
      setSaving(false);
    }
  };

  const connectButton = (label: string, variant: 'primary' | 'secondary') => (
    <Button variant={variant} size="sm" className={ROW_BUTTON} onClick={onConnect} pending={opening} disabled={!!leaving && !opening}>
      {opening ? 'Opening Google' : label}
    </Button>
  );

  const confirm = (
    <ConfirmDialog
      open={confirming}
      onClose={() => setConfirming(false)}
      title="Disconnect Google Calendar?"
      body="Taro stops reading your calendar and gives up its access at Google. Meetings only your calendar brought in won't be joined."
      confirmLabel="Disconnect"
      pendingLabel="Disconnecting"
      fallback="Couldn't disconnect Google Calendar."
      onConfirm={async () => {
        await api.googleCalendar.disconnect();
        refocus.current = true;
        setConfirming(false);
        showToast('Google Calendar disconnected.');
        onChanged();
      }}
    />
  );

  if (!calendar.connected) {
    return (
      <SetupRow
        id="setup-google-calendar"
        label="Google Calendar"
        state="Not connected"
        purpose="Connect your own calendar and Taro joins your meetings that have a video link, with nothing to paste. It only reads your calendar and never changes it."
        actions={connectButton('Connect Google Calendar', 'secondary')}
      />
    );
  }

  if (calendar.needsReconnect) {
    return (
      <>
        <SetupRow
          id="setup-google-calendar"
          label="Google Calendar"
          state="Reconnect needed"
          purpose={
            <>
              Taro lost access to <span className="wrap-anywhere">{calendar.email ?? 'your calendar'}</span>, so it isn&apos;t
              joining meetings from that calendar. Reconnect to pick up again.
            </>
          }
          stackActions
          actions={
            <>
              {connectButton('Reconnect Google Calendar', 'primary')}
              <Button variant="ghost" size="sm" className={ROW_BUTTON} onClick={() => setConfirming(true)} disabled={opening}>
                Disconnect
              </Button>
            </>
          }
        />
        {confirm}
      </>
    );
  }

  return (
    <>
      <SetupRow
        id="setup-google-calendar"
        label="Google Calendar"
        state={
          <>
            Connected as <span className="wrap-anywhere">{calendar.email}</span>
          </>
        }
        purpose={`Taro reads your calendar and never changes it. Meetings it joins show up in Meetings for everyone in ${workspaceName}.`}
        meta={calendar.lastSyncedAt ? `Synced ${timeAgo(calendar.lastSyncedAt)}` : 'Not synced yet'}
        actions={
          <Button variant="destructive" size="sm" className={ROW_BUTTON} onClick={() => setConfirming(true)}>
            Disconnect
          </Button>
        }
      >
        <div className="mt-3 border-t border-rule-soft pt-1">
          <SwitchRow label="Join my meetings automatically" checked={autoJoin} onCheckedChange={(on) => save({ autoJoin: on })} disabled={saving} />
          {autoJoin && (
            <fieldset disabled={saving} className="pb-1">
              <legend className="sr-only">Which meetings Taro joins</legend>
              {JOIN_MODES.map((mode) => (
                <label key={mode.value} className="flex min-h-11 cursor-pointer items-start gap-3 py-2.5 text-sm text-ink-2">
                  <input
                    type="radio"
                    name="google-calendar-join"
                    value={mode.value}
                    checked={joinMode === mode.value}
                    onChange={() => save({ joinMode: mode.value })}
                    className="mt-0.5 h-4 w-4 shrink-0 accent-taro"
                  />
                  {mode.label}
                </label>
              ))}
            </fieldset>
          )}
        </div>
      </SetupRow>
      {confirm}
    </>
  );
}

// ---------------------------------------------------------------------------------------------
// Calendar invitations

/**
 * The workspace's Taro address. Adding it to a meeting invite, once for a recurring series, brings
 * Taro to the meeting at its start. Everyone can see and copy it; owners and admins can rotate it
 * when it ends up somewhere it shouldn't.
 */
export function CalendarRow({ canEdit }: { canEdit: boolean }) {
  const guard = useSessionGuard();
  const [address, setAddress] = React.useState<string | null>(null);
  const [error, setError] = React.useState('');
  const [copied, setCopied] = React.useState(false);
  const [confirming, setConfirming] = React.useState(false);

  React.useEffect(() => {
    let cancelled = false;
    api.calendar
      .address()
      .then(({ address }) => {
        if (cancelled) return;
        setAddress(address);
        setError('');
      })
      .catch((e) => {
        if (!cancelled && !guard(e)) setError(errorText(e, "Couldn't load Taro's address."));
      });
    return () => {
      cancelled = true;
    };
  }, [guard]);

  // "Copied" stays a moment, then the button reads as before.
  React.useEffect(() => {
    if (!copied) return;
    const timer = window.setTimeout(() => setCopied(false), 2000);
    return () => window.clearTimeout(timer);
  }, [copied]);

  const copy = async () => {
    if (!address) return;
    try {
      await navigator.clipboard.writeText(address);
      setCopied(true);
    } catch {
      showToast("Couldn't copy it. Select the address and copy it yourself.", 'error');
    }
  };

  return (
    <>
      <SetupRow
        id="setup-calendar"
        label="Calendar"
        state={address ? <span className="font-mono text-[0.88em] wrap-anywhere">{address}</span> : undefined}
        purpose={
          error ||
          (address ? (
            'Add this address to a meeting invite, once for a recurring series, and Taro joins at the start.'
          ) : (
            <span className="text-meta text-ash">Loading the address</span>
          ))
        }
        meta={address ? 'Invites from members join on their own. Invites from anyone else wait for an owner or admin to approve them in Meetings.' : null}
        actions={
          address ? (
            <>
              <Button variant="secondary" size="sm" className={ROW_BUTTON} onClick={copy}>
                {copied ? 'Copied' : 'Copy address'}
              </Button>
              {canEdit && (
                <Button variant="ghost" size="sm" className={ROW_BUTTON} onClick={() => setConfirming(true)}>
                  Rotate
                </Button>
              )}
            </>
          ) : null
        }
      />
      <ConfirmDialog
        open={confirming}
        onClose={() => setConfirming(false)}
        title="Rotate Taro's address?"
        body="Taro gets a new address, and the old one stops working at once, even for meetings that already list it. Meetings in Upcoming stay scheduled. Add the new address to the invites Taro should keep joining."
        confirmLabel="Rotate address"
        pendingLabel="Rotating"
        fallback="Couldn't rotate the address."
        onConfirm={async () => {
          const { address } = await api.calendar.rotate();
          setAddress(address);
          setConfirming(false);
          showToast('New address ready. Copy it into your invites.');
        }}
      />
    </>
  );
}

// ---------------------------------------------------------------------------------------------
// The Google Meet button (section 12, Phase 2)

const EXTENSION_URL = process.env.NEXT_PUBLIC_TARO_EXTENSION_URL;

function SessionTimes({ session }: { session: ConnectedSession }) {
  const now = Date.now();
  const used = session.lastUsedAt;
  return (
    <>
      Connected <Time iso={session.createdAt} format="day" inSentence />
      {' · '}
      {!used ? (
        'not used yet'
      ) : daysBefore(used, now) === 0 ? (
        <>
          last used at <Time iso={used} format="clock" />
        </>
      ) : (
        <>
          last used <Time iso={used} format="day" inSentence />
        </>
      )}
    </>
  );
}

/** The Invite Taro button for Google Meet: what it is, how an admin rolls it out, and this person's connected browsers. */
function MeetButtonRow({ canEdit }: { canEdit: boolean }) {
  const guard = useSessionGuard();
  const [sessions, setSessions] = React.useState<ConnectedSession[] | null>(null);
  const [error, setError] = React.useState('');
  const [revoking, setRevoking] = React.useState<string | null>(null);
  const headingRef = React.useRef<HTMLHeadingElement>(null);

  const load = React.useCallback(async () => {
    try {
      const { sessions } = await api.sessions.list();
      setSessions(sessions.filter((s) => s.kind === 'extension'));
      setError('');
    } catch (e) {
      if (!guard(e)) setError(errorText(e, "Couldn't load your browsers."));
    }
  }, [guard]);

  // A browser usually connects in another tab, so look again when this one comes back.
  React.useEffect(() => {
    load();
    const onVisible = () => {
      if (document.visibilityState === 'visible') load();
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => document.removeEventListener('visibilitychange', onVisible);
  }, [load]);

  const revoke = async (session: ConnectedSession) => {
    const list = sessions ?? [];
    const at = list.findIndex((s) => s._id === session._id);
    // Its row goes away, so focus moves to a neighbor's button, or the list's heading.
    const neighbor = list[at + 1] ?? list[at - 1];
    setRevoking(session._id);
    try {
      await api.sessions.revoke(session._id);
      showToast(`Disconnected ${session.label || 'that browser'}.`);
      await load();
      window.setTimeout(() => (document.getElementById(`browser-${neighbor?._id}`) ?? headingRef.current)?.focus(), 0);
    } catch (e) {
      if (!guard(e)) showToast(errorText(e, "Couldn't disconnect that browser."), 'error');
    } finally {
      setRevoking(null);
    }
  };

  return (
    <SetupRow
      label="Google Meet button"
      state="Chrome and Edge extension"
      purpose="Puts an Invite Taro button at the bottom left of every Google Meet call, so one click sends Taro in."
      actions={
        EXTENSION_URL ? (
          <Button asChild variant="secondary" size="sm" className={ROW_BUTTON}>
            <a href={EXTENSION_URL} target="_blank" rel="noreferrer">
              Get the extension
            </a>
          </Button>
        ) : null
      }
    >
      {canEdit && (
        <p className="mt-2 text-sm text-ink-2">
          A Google Workspace admin can install it for everyone. In the Admin console, go to Devices, Chrome, Apps and
          extensions, add the Taro extension, and set it to Force install.
        </p>
      )}
      <div className="mt-4">
        <h4 ref={headingRef} tabIndex={-1} className="text-meta font-semibold text-ash">
          Your browsers
        </h4>
        {error && !sessions ? (
          <p className="mt-1 text-sm text-ink-2">{error}</p>
        ) : !sessions ? (
          <p className="mt-1 text-meta text-ash">Loading your browsers</p>
        ) : sessions.length === 0 ? (
          <p className="mt-1 text-sm text-ink-2">
            No browsers are connected yet. Click the Taro button in any Google Meet call to connect one.
          </p>
        ) : (
          <ul className="list-none">
            {sessions.map((session) => (
              <li key={session._id} className="flex items-center justify-between gap-3 border-b border-rule-soft py-2.5 last:border-b-0">
                <div className="min-w-0">
                  <p className="truncate text-ui font-semibold text-ink">{session.label || 'Browser'}</p>
                  <p className="text-meta text-ash">
                    <SessionTimes session={session} />
                  </p>
                </div>
                <Button
                  id={`browser-${session._id}`}
                  variant="destructive"
                  size="sm"
                  className="shrink-0"
                  onClick={() => revoke(session)}
                  pending={revoking === session._id}
                >
                  {revoking === session._id ? 'Disconnecting' : 'Disconnect'}
                </Button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </SetupRow>
  );
}
