'use client';

import { useEffect, useState } from 'react';
import { useParams, useSearchParams } from 'next/navigation';
import { AVAILABLE_INTEGRATIONS, IntegrationInfo } from '@taro/shared';
import { api, Company, Meeting, ActionLog, ApiError } from '@/lib/api';

interface IntegrationStatus {
  type: string;
  connected: boolean;
  teamName?: string;
  connectedAt?: string;
}

export default function Dashboard() {
  const params = useParams();
  const searchParams = useSearchParams();
  const companyId = params.companyId as string;

  const [company, setCompany] = useState<Company | null>(null);
  const [meetings, setMeetings] = useState<Meeting[]>([]);
  const [actionLogs, setActionLogs] = useState<ActionLog[]>([]);
  const [integrations, setIntegrations] = useState<IntegrationStatus[]>([]);
  const [loading, setLoading] = useState(true);
  const [toast, setToast] = useState('');

  // Manual "join a meeting" form
  const [meetUrl, setMeetUrl] = useState('');
  const [joining, setJoining] = useState(false);
  const [joinError, setJoinError] = useState('');

  useEffect(() => {
    if (searchParams.get('slack') === 'connected') {
      setToast('Slack connected successfully');
      setTimeout(() => setToast(''), 3000);
    }
  }, [searchParams]);

  useEffect(() => {
    async function fetchData() {
      try {
        const [companyData, meetingsData, logsData, slackStatus] = await Promise.all([
          api.companies.get(companyId),
          api.meetings.list(companyId),
          api.commands.logs(companyId),
          api.slack.status(companyId),
        ]);

        setCompany(companyData);
        setMeetings(meetingsData);
        setActionLogs(logsData);
        setIntegrations([
          {
            type: 'slack',
            connected: slackStatus.connected,
            teamName: slackStatus.teamName,
            connectedAt: slackStatus.connectedAt,
          },
        ]);
      } catch (error) {
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
  }, [companyId]);

  const joinMeeting = async (e: React.FormEvent) => {
    e.preventDefault();
    setJoining(true);
    setJoinError('');

    try {
      const meeting = await api.meetings.create({ companyId, meetUrl: meetUrl.trim() });
      setMeetings(prev => [meeting, ...prev]);
      setMeetUrl('');
      setToast('Taro is joining the meeting');
      setTimeout(() => setToast(''), 3000);
    } catch (error) {
      if (error instanceof ApiError) {
        setJoinError(error.message);
      } else {
        setJoinError('Failed to join meeting');
      }
    } finally {
      setJoining(false);
    }
  };

  const connectIntegration = (type: string) => {
    if (type === 'slack') {
      window.location.href = api.slack.getInstallUrl(companyId);
    }
  };

  const disconnectIntegration = async (type: string) => {
    if (type === 'slack') {
      try {
        await api.slack.disconnect(companyId);
        setIntegrations(prev =>
          prev.map(i => (i.type === 'slack' ? { ...i, connected: false } : i))
        );
        setToast('Slack disconnected');
        setTimeout(() => setToast(''), 3000);
      } catch (error) {
        if (error instanceof ApiError) {
          setToast(error.message);
        } else {
          setToast('Failed to disconnect');
        }
      }
    }
  };

  const getIntegrationStatus = (type: string): IntegrationStatus | undefined => {
    return integrations.find(i => i.type === type);
  };

  const getStatusStyle = (status: string) => {
    const styles: Record<string, string> = {
      pending: 'bg-amber-50 text-amber-700 border-amber-200',
      joining: 'bg-blue-50 text-blue-700 border-blue-200',
      active: 'bg-green-50 text-green-700 border-green-200',
      ended: 'bg-gray-50 text-gray-600 border-gray-200',
      error: 'bg-red-50 text-red-700 border-red-200',
    };
    return styles[status] || styles.pending;
  };

  const getActionStatusStyle = (status: string) => {
    const styles: Record<string, string> = {
      success: 'bg-green-50 text-green-700 border-green-200',
      failed: 'bg-red-50 text-red-700 border-red-200',
      clarification_needed: 'bg-amber-50 text-amber-700 border-amber-200',
    };
    return styles[status] || styles.clarification_needed;
  };

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-gray-500 text-sm">Loading...</div>
      </div>
    );
  }

  if (!company) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-red-600 text-sm">Company not found</div>
      </div>
    );
  }

  return (
    <main className="min-h-screen p-8">
      {toast && (
        <div className="fixed top-4 right-4 bg-gray-900 text-white px-4 py-2 rounded-md text-sm">
          {toast}
        </div>
      )}

      <div className="max-w-3xl mx-auto">
        <div className="mb-8">
          <h1 className="text-2xl font-semibold text-gray-900">{company.name}</h1>
          <p className="text-gray-500 text-sm">{company.domain}</p>
        </div>

        <div className="bg-white border border-gray-200 rounded-lg p-6 mb-6">
          <h2 className="text-sm font-medium text-gray-900 mb-4">Integrations</h2>
          <p className="text-gray-600 text-sm mb-6">
            Connect services to automatically detect and join meetings.
          </p>

          <div className="space-y-3">
            {AVAILABLE_INTEGRATIONS.map((integration: IntegrationInfo) => {
              const status = getIntegrationStatus(integration.type);
              const isConnected = status?.connected;

              return (
                <div
                  key={integration.type}
                  className="flex items-center justify-between p-4 border border-gray-200 rounded-lg"
                >
                  <div className="flex-1">
                    <div className="flex items-center gap-2">
                      <span className="font-medium text-gray-900 text-sm">
                        {integration.name}
                      </span>
                      {!integration.available && (
                        <span className="text-xs text-gray-400 border border-gray-200 px-2 py-0.5 rounded">
                          Coming soon
                        </span>
                      )}
                    </div>
                    <p className="text-xs text-gray-500 mt-1">
                      {integration.description}
                    </p>
                    {isConnected && status?.teamName && (
                      <p className="text-xs text-green-600 mt-1">
                        Connected to {status.teamName}
                      </p>
                    )}
                  </div>

                  <div className="flex items-center gap-2">
                    {isConnected ? (
                      <>
                        <div className="w-2 h-2 bg-green-500 rounded-full"></div>
                        <button
                          onClick={() => disconnectIntegration(integration.type)}
                          className="text-xs text-gray-500 hover:text-gray-700"
                        >
                          Disconnect
                        </button>
                      </>
                    ) : integration.available ? (
                      <button
                        onClick={() => connectIntegration(integration.type)}
                        className="text-sm text-white bg-gray-900 hover:bg-gray-800 px-3 py-1.5 rounded-md transition"
                      >
                        Connect
                      </button>
                    ) : (
                      <span className="text-xs text-gray-400">Unavailable</span>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        <div className="bg-white border border-gray-200 rounded-lg p-6 mb-6">
          <h2 className="text-sm font-medium text-gray-900 mb-4">Join a Meeting</h2>
          <p className="text-gray-600 text-sm mb-4">
            Paste a Google Meet link and Taro will join right away — no Slack message needed.
          </p>
          <form onSubmit={joinMeeting} className="flex gap-2">
            <input
              type="url"
              value={meetUrl}
              onChange={(e) => setMeetUrl(e.target.value)}
              placeholder="https://meet.google.com/xxx-xxxx-xxx"
              className="flex-1 px-3 py-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-taro-500 focus:border-transparent text-sm"
              required
            />
            <button
              type="submit"
              disabled={joining}
              className="text-sm text-white bg-gray-900 hover:bg-gray-800 disabled:opacity-50 px-4 py-2 rounded-md transition"
            >
              {joining ? 'Joining...' : 'Join'}
            </button>
          </form>
          {joinError && <div className="text-red-600 text-sm mt-2">{joinError}</div>}
        </div>

        <div className="bg-white border border-gray-200 rounded-lg p-6 mb-6">
          <h2 className="text-sm font-medium text-gray-900 mb-4">Recent Meetings</h2>
          {meetings.length === 0 ? (
            <p className="text-gray-500 text-sm">
              No meetings yet. Connect an integration above to start auto-joining meetings.
            </p>
          ) : (
            <div className="space-y-2">
              {meetings.map((meeting) => (
                <div
                  key={meeting._id}
                  className="flex items-center justify-between p-3 border border-gray-100 rounded-md"
                >
                  <div>
                    <div className="text-sm text-gray-900 truncate max-w-md">
                      {meeting.meetUrl.replace('https://', '')}
                    </div>
                    <div className="text-xs text-gray-500">
                      {new Date(meeting.createdAt).toLocaleString()}
                    </div>
                  </div>
                  <span className={`text-xs px-2 py-1 rounded border ${getStatusStyle(meeting.status)}`}>
                    {meeting.status}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="bg-white border border-gray-200 rounded-lg p-6">
          <h2 className="text-sm font-medium text-gray-900 mb-4">Recent Actions</h2>
          {actionLogs.length === 0 ? (
            <p className="text-gray-500 text-sm">
              No actions yet. Say "Hey Taro, post hello to #general" in a meeting and the
              result will show up here.
            </p>
          ) : (
            <div className="space-y-2">
              {actionLogs.map((log) => (
                <div
                  key={log._id}
                  className="flex items-start justify-between p-3 border border-gray-100 rounded-md gap-3"
                >
                  <div className="min-w-0">
                    <div className="text-sm text-gray-900">
                      "{log.command}"
                    </div>
                    <div className="text-xs text-gray-500 mt-1">
                      {log.status === 'success' && log.result}
                      {log.status === 'failed' && (log.errorMessage || 'Failed')}
                      {log.status === 'clarification_needed' && "Couldn't understand the command"}
                    </div>
                    <div className="text-xs text-gray-400 mt-1">
                      {new Date(log.createdAt).toLocaleString()}
                    </div>
                  </div>
                  <span className={`text-xs px-2 py-1 rounded border whitespace-nowrap ${getActionStatusStyle(log.status)}`}>
                    {log.status.replace('_', ' ')}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="mt-8 p-4 border border-gray-200 rounded-lg">
          <h3 className="text-sm font-medium text-gray-900 mb-2">How it works</h3>
          <ol className="text-sm text-gray-600 space-y-1">
            <li>1. Connect Slack above, or paste a Meet link directly</li>
            <li>2. Taro joins the meeting and listens</li>
            <li>3. Say <span className="font-medium">"Hey Taro, post hello to #general"</span></li>
            <li>4. When the meeting ends, Taro executes your commands and logs them here</li>
          </ol>
        </div>
      </div>
    </main>
  );
}
