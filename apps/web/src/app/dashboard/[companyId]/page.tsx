'use client';

import { useEffect, useState } from 'react';
import { useParams, useSearchParams } from 'next/navigation';
import { AVAILABLE_INTEGRATIONS, IntegrationInfo } from '@taro/shared';
import { api, Company, Meeting, ApiError } from '@/lib/api';

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
  const [integrations, setIntegrations] = useState<IntegrationStatus[]>([]);
  const [loading, setLoading] = useState(true);
  const [toast, setToast] = useState('');

  useEffect(() => {
    if (searchParams.get('slack') === 'connected') {
      setToast('Slack connected successfully');
      setTimeout(() => setToast(''), 3000);
    }
  }, [searchParams]);

  useEffect(() => {
    async function fetchData() {
      try {
        const [companyData, meetingsData, slackStatus] = await Promise.all([
          api.companies.get(companyId),
          api.meetings.list(companyId),
          api.slack.status(companyId),
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

        <div className="bg-white border border-gray-200 rounded-lg p-6">
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

        <div className="mt-8 p-4 border border-gray-200 rounded-lg">
          <h3 className="text-sm font-medium text-gray-900 mb-2">How it works</h3>
          <ol className="text-sm text-gray-600 space-y-1">
            <li>1. Connect your integrations above</li>
            <li>2. Taro will automatically detect meeting links</li>
            <li>3. In the meeting, say <span className="font-medium">"Hey Taro, post hello to #general"</span></li>
          </ol>
        </div>
      </div>
    </main>
  );
}
