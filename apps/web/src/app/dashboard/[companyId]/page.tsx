'use client';

import { useEffect, useRef, useState } from 'react';
import { useParams, useRouter, useSearchParams } from 'next/navigation';
import { AVAILABLE_INTEGRATIONS, IntegrationInfo, GITHUB_CAPABILITIES } from '@taro/shared';
import { api, Company, Meeting, MeetingDetail, ApiError, TOKEN_STORAGE_KEY, LICENSE_STORAGE_KEY } from '@/lib/api';
import { Wordmark, WaveMark, SlackIcon, GithubIcon, CalendarIcon } from '@/components/brand';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Spinner } from '@/components/ui/spinner';
import { showToast } from '@/components/ui/toast-store';
import { Select } from '@/components/ui/select';
import { Separator } from '@/components/ui/separator';
import { Card, CardContent } from '@/components/ui/card';
import { cn } from '@/lib/utils';
import { Dialog, DialogBody, DialogFooter } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';

interface IntegrationStatus {
  type: string;
  connected: boolean;
  configured?: boolean;
  teamName?: string;
  accountLogin?: string;
  repo?: string;
  needsRepo?: boolean;
  enabledActions?: string[];
  connectedAt?: string;
}

const MEETING_BADGE: Record<
  string,
  'warning' | 'info' | 'success' | 'muted' | 'destructive'
> = {
  pending: 'warning',
  joining: 'info',
  active: 'success',
  ended: 'muted',
  error: 'destructive',
};

const ACTION_BADGE: Record<string, 'success' | 'destructive' | 'warning'> = {
  success: 'success',
  failed: 'destructive',
  clarification_needed: 'warning',
};

function IntegrationIcon({ type }: { type: string }) {
  if (type === 'slack') return <SlackIcon className="w-6 h-6" />;
  if (type === 'github') return <GithubIcon className="w-6 h-6 text-fog-900" />;
  return <CalendarIcon className="w-6 h-6 text-fog-400" />;
}

// Default repository picker for the GitHub App installation
function RepoPicker({
  repos,
  value,
  saving,
  onChange,
}: {
  repos: string[];
  value?: string;
  saving: boolean;
  onChange: (repo: string) => void;
}) {
  return (
    <div className="flex items-center gap-2">
      <Select
        value={value || ''}
        disabled={saving || repos.length === 0}
        onChange={(e) => onChange(e.target.value)}
        className="max-w-xs"
      >
        <option value="" disabled>
          {repos.length === 0 ? 'No repositories granted yet' : 'Choose where issues are filed'}
        </option>
        {repos.map((repo) => (
          <option key={repo} value={repo}>
            {repo}
          </option>
        ))}
      </Select>
      {saving && <Spinner className="w-4 h-4 text-fog-400" />}
    </div>
  );
}

export default function Dashboard() {
  const params = useParams();
  const router = useRouter();
  const searchParams = useSearchParams();
  const companyId = params.companyId as string;

  const [company, setCompany] = useState<Company | null>(null);
  const [meetings, setMeetings] = useState<Meeting[]>([]);
  const [integrations, setIntegrations] = useState<IntegrationStatus[]>([]);
  const [loading, setLoading] = useState(true);

  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [details, setDetails] = useState<Record<string, MeetingDetail>>({});
  const [keyCopied, setKeyCopied] = useState(false);
  const [finishing, setFinishing] = useState(false);
  const [githubRepos, setGithubRepos] = useState<string[]>([]);
  const [repoSaving, setRepoSaving] = useState(false);
  const [clearing, setClearing] = useState(false);
  const [showArchived, setShowArchived] = useState(false);
  const [archived, setArchived] = useState<Meeting[]>([]);
  // Type-to-confirm removal of an integration
  const [removeTarget, setRemoveTarget] = useState<{ type: string; name: string } | null>(null);
  const [removeInput, setRemoveInput] = useState('');
  const [removing, setRemoving] = useState(false);
  const [showPerms, setShowPerms] = useState(false);

  // Show the post-OAuth toast exactly once. Effects can re-run (React dev
  // double-invoke, re-renders), so a ref guards against a duplicate, and we
  // strip the one-time query params so a refresh can't replay it either.
  const handledParams = useRef('');
  useEffect(() => {
    const key = searchParams.toString();
    if (!key || handledParams.current === key) return;
    handledParams.current = key;

    const slack = searchParams.get('slack') === 'connected';
    const github = searchParams.get('github') === 'connected';
    const error = searchParams.get('error');
    if (slack) showToast('Slack connected');
    if (github) showToast('Taro GitHub app installed');
    if (error?.startsWith('github')) showToast('GitHub installation did not complete. Try again.', 'error');

    if (slack || github || error) router.replace(`/dashboard/${companyId}`);
  }, [searchParams, router, companyId]);

  useEffect(() => {
    async function fetchData() {
      try {
        const [companyData, meetingsData, slackStatus, githubStatus] = await Promise.all([
          api.companies.get(companyId),
          api.meetings.list(companyId),
          api.slack.status(companyId),
          api.github.status(companyId),
        ]);

        setCompany(companyData);
        setMeetings(meetingsData);
        setIntegrations([
          {
            type: 'slack',
            connected: slackStatus.connected,
            teamName: slackStatus.teamName,
            connectedAt: slackStatus.connectedAt,
          },
          {
            type: 'github',
            connected: githubStatus.connected,
            configured: githubStatus.configured,
            accountLogin: githubStatus.accountLogin,
            repo: githubStatus.repo,
            needsRepo: githubStatus.needsRepo,
            enabledActions: githubStatus.enabledActions,
            connectedAt: githubStatus.connectedAt,
          },
        ]);
      } catch (error) {
        if (error instanceof ApiError && (error.statusCode === 401 || error.statusCode === 403)) {
          // No valid session for this workspace (or the license was revoked):
          // back to the door
          localStorage.removeItem(TOKEN_STORAGE_KEY);
          router.replace('/');
          return;
        }
        if (error instanceof ApiError && error.statusCode === 404) {
          setCompany(null);
        } else {
          console.error('Error fetching data:', error);
        }
      } finally {
        setLoading(false);
      }
    }

    fetchData();
    const interval = setInterval(fetchData, 5000);
    return () => clearInterval(interval);
  }, [companyId, router]);

  // Keep the expanded meeting's detail fresh: commands and the transcript
  // arrive after the meeting ends, while the panel may already be open
  useEffect(() => {
    if (!expandedId) return;
    let cancelled = false;

    const load = async () => {
      try {
        const detail = await api.meetings.get(expandedId);
        if (!cancelled) {
          setDetails((prev) => ({ ...prev, [expandedId]: detail }));
        }
      } catch (error) {
        console.error('Error fetching meeting detail:', error);
      }
    };

    load();
    const interval = setInterval(load, 5000);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [expandedId]);

  const getIntegrationStatus = (type: string): IntegrationStatus | undefined =>
    integrations.find((i) => i.type === type);

  const slackConnected = !!getIntegrationStatus('slack')?.connected;
  const github = getIntegrationStatus('github');
  const githubConnected = !!github?.connected;
  const needsOnboarding = !!company && !company.onboardedAt;

  // Load the granted repositories once the app is installed
  useEffect(() => {
    if (!githubConnected) {
      setGithubRepos([]);
      return;
    }
    api.github
      .repos(companyId)
      .then(({ repos }) => setGithubRepos(repos))
      .catch((error) => console.error('Error loading GitHub repos:', error));
  }, [githubConnected, companyId]);

  const connectIntegration = (type: string) => {
    if (type === 'slack') {
      window.location.href = api.slack.getInstallUrl(companyId);
    }
    if (type === 'github') {
      if (github?.configured === false) {
        showToast('The Taro GitHub app is not configured on this server yet.', 'error');
        return;
      }
      window.location.href = api.github.getInstallUrl(companyId);
    }
  };

  const chooseRepo = async (repo: string) => {
    setRepoSaving(true);
    try {
      await api.github.setRepo({ companyId, repo });
      setIntegrations((prev) =>
        prev.map((i) => (i.type === 'github' ? { ...i, repo, needsRepo: false } : i))
      );
      showToast(`Issues will be filed in ${repo}`);
    } catch (error) {
      showToast(error instanceof ApiError ? error.message : 'Could not save the repository', 'error');
    } finally {
      setRepoSaving(false);
    }
  };

  // Consequences shown in the confirm dialog, specific to each integration
  const removalWarning = (type: string): string => {
    if (type === 'slack') {
      return 'Taro will stop watching your Slack channels for Google Meet links and can no longer join meetings or post results back. Your meeting history is kept.';
    }
    if (type === 'github') {
      return 'Taro will no longer be able to file GitHub issues by voice. This removes the connection on Taro\'s side; to fully revoke access, also uninstall the Taro app from your GitHub settings.';
    }
    return 'This integration will be disconnected.';
  };

  const openRemove = (type: string, name: string) => {
    setRemoveTarget({ type, name });
    setRemoveInput('');
  };

  const closeRemove = () => {
    if (removing) return;
    setRemoveTarget(null);
    setRemoveInput('');
  };

  const confirmRemove = async () => {
    if (!removeTarget) return;
    const { type, name } = removeTarget;
    setRemoving(true);
    try {
      if (type === 'slack') {
        await api.slack.disconnect(companyId);
      } else if (type === 'github') {
        await api.github.disconnect(companyId);
      }
      setIntegrations((prev) =>
        prev.map((i) => (i.type === type ? { ...i, connected: false } : i))
      );
      showToast(`${name} disconnected`);
      setRemoveTarget(null);
      setRemoveInput('');
    } catch (error) {
      showToast(error instanceof ApiError ? error.message : 'Failed to disconnect', 'error');
    } finally {
      setRemoving(false);
    }
  };

  const removeConfirmed =
    !!removeTarget && removeInput.trim().toLowerCase() === removeTarget.name.toLowerCase();

  const copyLicenseKey = async () => {
    if (!company?.licenseKey) return;
    await navigator.clipboard.writeText(company.licenseKey);
    setKeyCopied(true);
    setTimeout(() => setKeyCopied(false), 2000);
  };

  const switchWorkspace = () => {
    localStorage.removeItem(TOKEN_STORAGE_KEY);
    localStorage.removeItem(LICENSE_STORAGE_KEY);
    router.push('/');
  };

  const finishOnboarding = async () => {
    setFinishing(true);
    try {
      const updated = await api.companies.completeOnboarding(companyId);
      setCompany(updated);
    } catch (error) {
      showToast(error instanceof ApiError ? error.message : 'Failed to finish setup', 'error');
    } finally {
      setFinishing(false);
    }
  };

  const toggleMeeting = (id: string) => {
    setExpandedId((prev) => (prev === id ? null : id));
  };

  const loadArchived = async () => {
    try {
      setArchived(await api.meetings.list(companyId, true));
    } catch (error) {
      console.error('Error loading archived meetings:', error);
    }
  };

  const toggleArchived = () => {
    const next = !showArchived;
    setShowArchived(next);
    if (next) loadArchived();
  };

  const clearHistory = async () => {
    setClearing(true);
    try {
      const { archived: n } = await api.meetings.clearHistory();
      setMeetings([]);
      setExpandedId(null);
      if (showArchived) loadArchived();
      showToast(n === 0 ? 'History already clear' : `Archived ${n} meeting${n === 1 ? '' : 's'}`);
    } catch (error) {
      showToast(error instanceof ApiError ? error.message : 'Could not clear history', 'error');
    } finally {
      setClearing(false);
    }
  };

  // One meeting row, reused by the main list and the archive view
  const renderMeetingRow = (meeting: Meeting, archivedRow = false) => {
    const isExpanded = expandedId === meeting._id;
    const detail = details[meeting._id];
    const isLive = !archivedRow && meeting.status === 'active';
    const hearing =
      !!meeting.lastAudioAt && Date.now() - new Date(meeting.lastAudioAt).getTime() < 15_000;
    return (
      <div key={meeting._id}>
        <button
          onClick={() => toggleMeeting(meeting._id)}
          className="w-full flex items-center justify-between gap-4 p-4 text-left hover:bg-fog-50 transition focus-visible:outline-none focus-visible:bg-fog-50"
        >
          <div className="flex items-center gap-3 min-w-0">
            {isLive && <WaveMark live className="w-4 h-5 shrink-0" />}
            <div className="min-w-0">
              <div className="text-sm text-fog-900 truncate">
                {meeting.meetUrl.replace('https://', '')}
              </div>
              <div className="text-xs text-fog-400">
                {new Date(meeting.createdAt).toLocaleString()}
                {meeting.startedByName && (
                  <span className="text-fog-500"> · started by {meeting.startedByName}</span>
                )}
              </div>
            </div>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            {isLive && (
              <Badge variant={hearing ? 'success' : 'warning'}>
                {hearing ? 'hearing audio' : 'waiting for audio'}
              </Badge>
            )}
            <Badge variant={MEETING_BADGE[meeting.status] || 'warning'}>
              {isLive ? 'live' : meeting.status}
            </Badge>
          </div>
        </button>

        {isExpanded && (
          <div className="border-t border-fog-100 bg-fog-50/50 p-4 space-y-4">
            {!detail ? (
              <p className="text-xs text-fog-400">Loading</p>
            ) : (
              <>
                {isLive && (
                  <div>
                    <h4 className="text-xs font-medium uppercase tracking-wide text-fog-400 mb-2 flex items-center gap-2">
                      <WaveMark live className="w-3 h-4" /> Hearing now
                    </h4>
                    <pre className="text-xs font-mono text-fog-600 whitespace-pre-wrap bg-white border border-fog-200 rounded-xl p-3 max-h-32 overflow-y-auto">
                      {detail.liveTranscript ||
                        (hearing
                          ? 'Audio is flowing. Words appear here as sentences finish.'
                          : 'No audio has reached Taro yet. Admit it from the lobby if it is still waiting.')}
                    </pre>
                  </div>
                )}
                <div>
                  <h4 className="text-xs font-medium uppercase tracking-wide text-fog-400 mb-2">
                    Commands
                  </h4>
                  {detail.actionLogs.length === 0 ? (
                    <p className="text-xs text-fog-500">No commands heard in this meeting.</p>
                  ) : (
                    <div className="space-y-2">
                      {detail.actionLogs.map((log) => (
                        <Card key={log._id} className="rounded-xl">
                          <CardContent className="p-3">
                            <div className="flex items-center justify-between gap-2">
                              <span className="text-xs text-fog-900 truncate">
                                &ldquo;{log.command}&rdquo;
                              </span>
                              <Badge
                                variant={ACTION_BADGE[log.status] || 'warning'}
                                className="text-[11px] shrink-0"
                              >
                                {log.status.replace('_', ' ')}
                              </Badge>
                            </div>
                            <div className="text-xs text-fog-500 mt-1.5">
                              {log.intent.action}
                              {log.intent.source === 'fallback_regex' && ' · ⚠️ regex fallback'}
                              {log.result && ` · ${log.result}`}
                              {log.errorMessage && ` · ${log.errorMessage}`}
                            </div>
                          </CardContent>
                        </Card>
                      ))}
                    </div>
                  )}
                </div>

                {detail.transcript && (
                  <div>
                    <h4 className="text-xs font-medium uppercase tracking-wide text-fog-400 mb-2">
                      Transcript
                    </h4>
                    <pre className="text-xs font-mono text-fog-600 whitespace-pre-wrap bg-white border border-fog-200 rounded-xl p-3 max-h-40 overflow-y-auto">
                      {detail.transcript}
                    </pre>
                  </div>
                )}
              </>
            )}
          </div>
        )}
      </div>
    );
  };

  if (loading) {
    return (
      <main className="min-h-screen flex items-center justify-center">
        <Wordmark live />
      </main>
    );
  }

  if (!company) {
    return (
      <main className="min-h-screen flex flex-col items-center justify-center gap-4">
        <Wordmark />
        <p className="text-sm text-fog-600">This workspace doesn&apos;t exist.</p>
        <Button variant="link" onClick={switchWorkspace}>
          Go to sign in
        </Button>
      </main>
    );
  }

  const setAllCapabilities = async (all: boolean) => {
    const next = all ? GITHUB_CAPABILITIES.map((c) => c.action as string) : [];
    setIntegrations((prev) =>
      prev.map((i) => (i.type === 'github' ? { ...i, enabledActions: next } : i))
    );
    try {
      await api.github.setCapabilities({ companyId, actions: next });
    } catch (error) {
      showToast(error instanceof ApiError ? error.message : 'Could not update permissions', 'error');
    }
  };

  const toggleCapability = async (action: string) => {
    const current = github?.enabledActions ?? [];
    const next = current.includes(action)
      ? current.filter((a) => a !== action)
      : [...current, action];
    setIntegrations((prev) =>
      prev.map((i) => (i.type === 'github' ? { ...i, enabledActions: next } : i))
    );
    try {
      await api.github.setCapabilities({ companyId, actions: next });
    } catch (error) {
      showToast(error instanceof ApiError ? error.message : 'Could not update permissions', 'error');
    }
  };

  const githubRepoPicker =
    githubConnected && (github?.needsRepo || githubRepos.length > 1) ? (
      <div className="mt-3">
        <RepoPicker repos={githubRepos} value={github?.repo} saving={repoSaving} onChange={chooseRepo} />
      </div>
    ) : null;

  const enabledCount = (github?.enabledActions ?? []).length;
  const githubCapabilities = githubConnected ? (
    <div className="mt-3">
      <Button variant="outline" size="sm" onClick={() => setShowPerms(true)}>
        <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.7" className="h-3.5 w-3.5">
          <path d="M10 2l6 2.5v4.5c0 3.6-2.5 6.4-6 7.5-3.5-1.1-6-3.9-6-7.5V4.5L10 2z" strokeLinejoin="round" />
        </svg>
        Permissions
        <span className="text-fog-400">· {enabledCount}/{GITHUB_CAPABILITIES.length} on</span>
      </Button>
    </div>
  ) : null;

  return (
    <main className="min-h-screen">

      {/* Top nav */}
      <header className="sticky top-0 z-40 bg-fog-50/90 backdrop-blur border-b border-fog-200">
        <div className="max-w-5xl mx-auto px-6 h-16 flex items-center justify-between gap-4">
          <div className="flex items-center gap-4 min-w-0">
            <Wordmark />
            <Separator orientation="vertical" className="h-6 hidden sm:block" />
            <div className="min-w-0 hidden sm:block">
              <div className="text-sm font-medium text-fog-900 truncate">{company.name}</div>
              <div className="text-xs text-fog-400 truncate">{company.domain}</div>
            </div>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            {company.licenseKey && (
              <Button
                variant="outline"
                size="sm"
                onClick={copyLicenseKey}
                title="Copy license key"
                className="hidden md:inline-flex font-mono text-fog-500 hover:text-taro-700"
              >
                {keyCopied ? 'Copied ✓' : company.licenseKey}
              </Button>
            )}
            <Button variant="ghost" size="sm" onClick={switchWorkspace}>
              Sign out
            </Button>
          </div>
        </div>
      </header>

      <div className="max-w-5xl mx-auto px-6 py-10">
        {needsOnboarding ? (
          /* First-run onboarding */
          <div className="max-w-2xl mx-auto">
            <h1 className="font-display font-bold text-3xl tracking-tight text-fog-900 [text-wrap:balance]">
              Welcome, {company.name}
            </h1>
            <p className="mt-2 text-fog-600">
              Three steps and Taro is sitting in your meetings. Your license key in the top bar is
              how your team signs back in.
            </p>

            <div className="mt-8 space-y-4">
              {/* Step 1: Slack */}
              <Card>
                <CardContent className="flex items-start justify-between gap-4">
                  <div className="flex gap-4">
                    <SlackIcon className="w-8 h-8 mt-0.5" />
                    <div>
                      <h2 className="font-display font-semibold text-fog-900">
                        1&nbsp;&middot;&nbsp;Connect Slack
                      </h2>
                      <p className="text-sm text-fog-500 mt-1 max-w-md">
                        Taro watches your public channels for Google Meet links, joins the calls,
                        and posts what it did back into the thread.
                      </p>
                      {slackConnected && (
                        <Badge variant="success" className="mt-2.5">
                          ✓ Connected to {getIntegrationStatus('slack')?.teamName}
                        </Badge>
                      )}
                    </div>
                  </div>
                  {!slackConnected && (
                    <Button onClick={() => connectIntegration('slack')} className="shrink-0">
                      Connect
                    </Button>
                  )}
                </CardContent>
              </Card>

              {/* Step 2: GitHub */}
              <Card>
                <CardContent className="flex items-start justify-between gap-4">
                  <div className="flex gap-4">
                    <GithubIcon className="w-8 h-8 mt-0.5 text-fog-900" />
                    <div>
                      <h2 className="font-display font-semibold text-fog-900">
                        2&nbsp;&middot;&nbsp;Install the Taro GitHub app
                        <Badge variant="outline" className="ml-2 font-sans font-normal align-middle">
                          optional
                        </Badge>
                      </h2>
                      <p className="text-sm text-fog-500 mt-1 max-w-md">
                        Taro files issues as its own bot on the repos you choose. Nobody&apos;s
                        personal account is involved. Say: &ldquo;Hey Taro, create an issue about
                        the flaky deploy.&rdquo;
                      </p>
                      {githubConnected && (
                        <Badge variant="success" className="mt-2.5">
                          ✓ Installed on {github?.accountLogin}
                          {github?.repo && ` · ${github.repo}`}
                        </Badge>
                      )}
                      {githubRepoPicker}
                      {githubCapabilities}
                    </div>
                  </div>
                  {!githubConnected && (
                    <Button
                      variant="secondary"
                      onClick={() => connectIntegration('github')}
                      className="shrink-0"
                    >
                      Install
                    </Button>
                  )}
                </CardContent>
              </Card>

              {/* Step 3: first command */}
              <Card>
                <CardContent className="flex gap-4">
                  <div className="w-8 flex justify-center pt-0.5">
                    <WaveMark live className="w-7 h-9" />
                  </div>
                  <div>
                    <h2 className="font-display font-semibold text-fog-900">
                      3&nbsp;&middot;&nbsp;Run your first command
                    </h2>
                    <p className="text-sm text-fog-500 mt-1 max-w-md">
                      Post a Meet link in any public channel, admit Taro from the lobby, then say:
                    </p>
                    <p className="mt-3 font-mono text-sm text-taro-800 bg-taro-50 border border-taro-100 rounded-lg px-3 py-2 inline-block">
                      &ldquo;Hey Taro, post hello team to general&rdquo;
                    </p>
                  </div>
                </CardContent>
              </Card>
            </div>

            <div className="mt-8 flex items-center gap-4">
              <Button size="lg" onClick={finishOnboarding} disabled={!slackConnected || finishing}>
                {finishing && <Spinner />}
                {finishing ? 'Finishing' : 'Finish setup'}
              </Button>
              {!slackConnected && (
                <p className="text-xs text-fog-400">
                  Connect Slack first. It&apos;s how Taro finds your meetings.
                </p>
              )}
            </div>
          </div>
        ) : (
          /* Regular dashboard */
          <div className="space-y-8">
            {/* Integrations */}
            <section>
              <div className="flex items-baseline justify-between mb-4">
                <h2 className="font-display font-semibold text-lg text-fog-900">Integrations</h2>
                <p className="text-xs text-fog-400">Add or remove tools any time</p>
              </div>
              <div className="grid sm:grid-cols-2 gap-4">
                {AVAILABLE_INTEGRATIONS.map((integration: IntegrationInfo) => {
                  const status = getIntegrationStatus(integration.type);
                  const isConnected = !!status?.connected;

                  return (
                    <Card
                      key={integration.type}
                      className={integration.available ? '' : 'border-fog-100'}
                    >
                      <CardContent className="p-5">
                        <div className="flex items-start justify-between gap-3">
                          <div className="flex gap-3 min-w-0">
                            <IntegrationIcon type={integration.type} />
                            <div className="min-w-0">
                              <div className="flex items-center gap-2">
                                <span className="font-medium text-fog-900 text-sm">
                                  {integration.name}
                                </span>
                                {!integration.available && (
                                  <Badge variant="outline" className="text-[11px]">
                                    Coming soon
                                  </Badge>
                                )}
                                {isConnected && (
                                  <span
                                    className="w-1.5 h-1.5 rounded-full bg-emerald-500"
                                    aria-hidden
                                  />
                                )}
                              </div>
                              <p className="text-xs text-fog-500 mt-1 leading-relaxed">
                                {integration.description}
                              </p>
                              {isConnected && (
                                <p className="text-xs text-emerald-600 mt-1.5 truncate">
                                  {status?.teamName ||
                                    `Installed on ${status?.accountLogin}${status?.repo ? ` · ${status.repo}` : ''}`}
                                </p>
                              )}
                              {integration.type === 'github' && (
                                <>
                                  {githubRepoPicker}
                                  {githubCapabilities}
                                </>
                              )}
                            </div>
                          </div>
                          <div className="shrink-0">
                            {isConnected ? (
                              <Button
                                variant="destructive"
                                size="sm"
                                onClick={() => openRemove(integration.type, integration.name)}
                              >
                                Remove
                              </Button>
                            ) : integration.available ? (
                              <Button
                                variant="secondary"
                                size="sm"
                                onClick={() => connectIntegration(integration.type)}
                              >
                                {integration.type === 'github' ? 'Install' : 'Connect'}
                              </Button>
                            ) : null}
                          </div>
                        </div>
                      </CardContent>
                    </Card>
                  );
                })}
              </div>
            </section>

            {/* Meetings */}
            <section>
              <div className="flex items-center justify-between mb-4">
                <h2 className="font-display font-semibold text-lg text-fog-900">Meetings</h2>
                {meetings.length > 0 && (
                  <Button variant="ghost" size="sm" onClick={clearHistory} disabled={clearing}>
                    {clearing && <Spinner className="w-3.5 h-3.5" />}
                    {clearing ? 'Clearing' : 'Clear history'}
                  </Button>
                )}
              </div>
              <Card className="overflow-hidden">
                {meetings.length === 0 ? (
                  <div className="p-10 text-center">
                    <WaveMark className="w-8 h-10 opacity-40 inline-block" />
                    <p className="text-sm text-fog-500 mt-3">
                      No meetings in your history. Post a Google Meet link in a public Slack channel
                      and Taro will join it.
                    </p>
                  </div>
                ) : (
                  <div className="divide-y divide-fog-100">
                    {meetings.map((meeting) => renderMeetingRow(meeting))}
                  </div>
                )}
              </Card>

              {/* Archive: cleared meetings are kept here for good, out of the main list */}
              <div className="mt-4">
                <Button variant="link" size="sm" onClick={toggleArchived}>
                  {showArchived ? 'Hide archived meetings' : 'View archived meetings'}
                </Button>
                {showArchived && (
                  <Card className="overflow-hidden mt-2">
                    {archived.length === 0 ? (
                      <p className="text-sm text-fog-500 p-6 text-center">
                        Nothing archived yet. Clearing your history moves meetings here, they are
                        never deleted.
                      </p>
                    ) : (
                      <div className="divide-y divide-fog-100">
                        {archived.map((meeting) => renderMeetingRow(meeting, true))}
                      </div>
                    )}
                  </Card>
                )}
              </div>
            </section>

            {/* Voice command reference */}
            <Card className="bg-taro-50 border-taro-100">
              <CardContent>
                <h3 className="font-display font-semibold text-sm text-taro-900 mb-3">
                  Things you can say
                </h3>
                <div className="grid sm:grid-cols-3 gap-3 text-xs">
                  {[
                    ['Post a message', '“Hey Taro, post ship it to general”'],
                    ['Create a todo list', '“Hey Taro, make a todo list in projects about the launch, the docs and QA”'],
                    ['File a GitHub issue', '“Hey Taro, create an issue about the signup page crashing”'],
                  ].map(([label, phrase]) => (
                    <Card key={label} className="bg-white/70 border-taro-100 rounded-xl">
                      <CardContent className="p-3">
                        <div className="font-medium text-taro-800 mb-1">{label}</div>
                        <div className="text-fog-600 leading-relaxed">{phrase}</div>
                      </CardContent>
                    </Card>
                  ))}
                </div>
              </CardContent>
            </Card>
          </div>
        )}
      </div>

      <Dialog open={showPerms} onClose={() => setShowPerms(false)} labelledBy="perms-title">
        <DialogBody>
          <div className="flex items-start justify-between gap-3">
            <div>
              <h2 id="perms-title" className="font-display font-semibold text-lg text-fog-900">
                GitHub permissions
              </h2>
              <p className="mt-1 text-sm text-fog-500">
                What Taro may do. Off actions are refused even if spoken.
              </p>
            </div>
            <div className="flex gap-1.5 shrink-0">
              <Button variant="ghost" size="sm" onClick={() => setAllCapabilities(true)}>
                All on
              </Button>
              <Button variant="ghost" size="sm" onClick={() => setAllCapabilities(false)}>
                All off
              </Button>
            </div>
          </div>
          <div className="mt-1 max-h-[52vh] overflow-y-auto -mx-1 px-1">
            {GITHUB_CAPABILITIES.map((cap) => {
              const on = (github?.enabledActions ?? []).includes(cap.action);
              return (
                <button
                  key={cap.action}
                  onClick={() => toggleCapability(cap.action)}
                  className="flex w-full items-center justify-between gap-3 rounded-lg px-2 py-2 text-left transition hover:bg-fog-50"
                >
                  <span className="min-w-0">
                    <span className="block text-sm font-medium text-fog-800">{cap.label}</span>
                    <span className="block text-xs text-fog-500 truncate">{cap.description}</span>
                  </span>
                  <span
                    className={cn(
                      'flex h-5 w-9 shrink-0 items-center rounded-full transition-colors',
                      on ? 'bg-taro-600' : 'bg-fog-300'
                    )}
                  >
                    <span
                      className={cn(
                        'h-4 w-4 rounded-full bg-white shadow-sm transition-transform mx-0.5',
                        on ? 'translate-x-4' : 'translate-x-0'
                      )}
                    />
                  </span>
                </button>
              );
            })}
          </div>
        </DialogBody>
        <DialogFooter>
          <Button variant="ghost" size="sm" onClick={() => setShowPerms(false)}>
            Done
          </Button>
        </DialogFooter>
      </Dialog>

      <Dialog open={!!removeTarget} onClose={closeRemove} labelledBy="remove-title">
        {removeTarget && (
          <>
            <DialogBody>
              <h2 id="remove-title" className="font-display font-semibold text-lg text-fog-900">
                Remove {removeTarget.name}?
              </h2>
              <p className="text-sm text-fog-600 leading-relaxed">
                {removalWarning(removeTarget.type)}
              </p>
              <div>
                <label htmlFor="remove-confirm" className="block text-sm text-fog-600 mb-1.5">
                  Type <span className="font-mono font-medium text-fog-900">{removeTarget.name}</span>{' '}
                  to confirm.
                </label>
                <Input
                  id="remove-confirm"
                  value={removeInput}
                  onChange={(e) => setRemoveInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && removeConfirmed && !removing) confirmRemove();
                  }}
                  autoComplete="off"
                  spellCheck={false}
                  aria-invalid={removeInput.length > 0 && !removeConfirmed}
                  placeholder={removeTarget.name}
                />
              </div>
            </DialogBody>
            <DialogFooter>
              <Button variant="ghost" size="sm" onClick={closeRemove} disabled={removing}>
                Cancel
              </Button>
              <Button
                variant="destructive"
                size="sm"
                onClick={confirmRemove}
                disabled={!removeConfirmed || removing}
              >
                {removing && <Spinner className="w-3.5 h-3.5" />}
                {removing ? 'Removing' : `Remove ${removeTarget.name}`}
              </Button>
            </DialogFooter>
          </>
        )}
      </Dialog>
    </main>
  );
}
