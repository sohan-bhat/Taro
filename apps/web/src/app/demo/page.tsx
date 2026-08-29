'use client';

import { useState } from 'react';
import Link from 'next/link';
import { snapshot as rawSnapshot } from '@/demo/snapshot';
import type { DemoSnapshot, DemoLog } from '@/demo/types';
import { GITHUB_CAPABILITIES } from '@taro/shared';
import { Wordmark, WaveMark, SlackIcon, GithubIcon } from '@/components/brand';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import { Card, CardContent } from '@/components/ui/card';

const snapshot = rawSnapshot as unknown as DemoSnapshot;
const details = snapshot.details;
const meetings = snapshot.meetings;

const ACTION_BADGE: Record<string, 'success' | 'destructive' | 'warning'> = {
  success: 'success',
  failed: 'destructive',
  clarification_needed: 'warning',
};

function logsFor(id: string): DemoLog[] {
  return details[id]?.actionLogs ?? [];
}

export default function DemoDashboard() {
  const [expandedId, setExpandedId] = useState<string | null>(meetings[0]?._id ?? null);

  const gh = snapshot.github;
  const enabledCount = gh.enabledActions.length;
  const allLogs = meetings.flatMap((m) => logsFor(m._id));
  const completed = allLogs.filter((l) => l.status === 'success').length;
  const captured = new Date(snapshot.capturedAt).toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });

  return (
    <main className="min-h-screen">
      <header className="sticky top-0 z-40 bg-fog-50/90 backdrop-blur border-b border-fog-200">
        <div className="max-w-5xl mx-auto px-4 sm:px-6 h-16 flex items-center justify-between gap-3">
          <div className="flex items-center gap-4 min-w-0">
            <Wordmark />
            <Separator orientation="vertical" className="h-6 hidden sm:block" />
            <div className="min-w-0 hidden sm:block">
              <div className="text-sm font-medium text-fog-900 truncate">{snapshot.company.name}</div>
              <div className="text-xs text-fog-400 truncate">{snapshot.company.domain}</div>
            </div>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <Badge variant="default">Demo</Badge>
            <Button asChild variant="ghost" size="sm">
              <Link href="/">Exit demo</Link>
            </Button>
          </div>
        </div>
      </header>

      <div className="max-w-5xl mx-auto px-4 sm:px-6 py-8 sm:py-10 space-y-8">
        {/* What this is */}
        <Card className="bg-taro-50 border-taro-100">
          <CardContent className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex gap-4 min-w-0">
              <WaveMark className="w-7 h-9 shrink-0" />
              <div className="min-w-0">
                <h1 className="font-display font-semibold text-taro-900">A real Taro workspace, frozen in time</h1>
                <p className="text-sm text-fog-600 mt-1 max-w-2xl leading-relaxed">
                  This is a static snapshot of an actual workspace captured on {captured}. Everything below really
                  happened: Taro joined these Google Meet calls, heard the spoken commands, and did the work in Slack
                  and GitHub. It runs with no server so you can explore it any time.
                </p>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Headline stats */}
        <div className="grid grid-cols-3 gap-3 sm:gap-4">
          {[
            [meetings.length, 'Meetings joined'],
            [allLogs.length, 'Commands heard'],
            [completed, 'Actions completed'],
          ].map(([n, label]) => (
            <Card key={label as string}>
              <CardContent className="p-4 sm:p-5">
                <div className="font-display font-bold text-2xl sm:text-3xl text-taro-700">{n}</div>
                <div className="text-xs sm:text-sm text-fog-500 mt-0.5">{label}</div>
              </CardContent>
            </Card>
          ))}
        </div>

        {/* Integrations (read-only) */}
        <section>
          <div className="flex items-baseline justify-between mb-4">
            <h2 className="font-display font-semibold text-lg text-fog-900">Integrations</h2>
            <p className="text-xs text-fog-400">Connected in this workspace</p>
          </div>
          <div className="grid sm:grid-cols-2 gap-4">
            <Card>
              <CardContent className="p-5">
                <div className="flex gap-3 min-w-0">
                  <SlackIcon className="w-6 h-6 shrink-0" />
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="font-medium text-fog-900 text-sm">Slack</span>
                      <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" aria-hidden />
                    </div>
                    <p className="text-xs text-fog-500 mt-1 leading-relaxed">
                      Watches public channels for Meet links, joins the calls, and posts results back.
                    </p>
                    {snapshot.slack.connected && (
                      <p className="text-xs text-emerald-600 mt-1.5 truncate">
                        Connected to {snapshot.slack.teamName}
                      </p>
                    )}
                  </div>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardContent className="p-5">
                <div className="flex gap-3 min-w-0">
                  <GithubIcon className="w-6 h-6 shrink-0 text-fog-900" />
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="font-medium text-fog-900 text-sm">GitHub</span>
                      <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" aria-hidden />
                    </div>
                    <p className="text-xs text-fog-500 mt-1 leading-relaxed">
                      Files issues and opens pull requests as its own bot on the repos you choose.
                    </p>
                    {gh.connected && (
                      <p className="text-xs text-emerald-600 mt-1.5 truncate">
                        Installed on {gh.accountLogin}
                        {gh.repo ? ` · ${gh.repo}` : ''}
                      </p>
                    )}
                    <div className="mt-2 inline-flex items-center gap-1.5 rounded-lg border border-fog-200 bg-fog-50 px-2.5 py-1 text-xs text-fog-600">
                      <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.7" className="h-3.5 w-3.5">
                        <path d="M10 2l6 2.5v4.5c0 3.6-2.5 6.4-6 7.5-3.5-1.1-6-3.9-6-7.5V4.5L10 2z" strokeLinejoin="round" />
                      </svg>
                      {enabledCount}/{GITHUB_CAPABILITIES.length} permissions enabled
                    </div>
                  </div>
                </div>
              </CardContent>
            </Card>
          </div>
        </section>

        {/* Meetings */}
        <section>
          <h2 className="font-display font-semibold text-lg text-fog-900 mb-4">Meetings</h2>
          <Card className="overflow-hidden">
            {meetings.length === 0 ? (
              <div className="p-10 text-center text-sm text-fog-500">No meetings in this snapshot.</div>
            ) : (
              <div className="divide-y divide-fog-100">
                {meetings.map((meeting) => {
                  const isExpanded = expandedId === meeting._id;
                  const logs = logsFor(meeting._id);
                  return (
                    <div key={meeting._id}>
                      <button
                        onClick={() => setExpandedId((prev) => (prev === meeting._id ? null : meeting._id))}
                        className="w-full flex items-center justify-between gap-3 p-4 text-left hover:bg-fog-50 transition focus-visible:outline-none focus-visible:bg-fog-50"
                      >
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
                        <div className="flex items-center gap-2 shrink-0">
                          {logs.length > 0 && (
                            <Badge variant="muted" className="hidden sm:inline-flex">
                              {logs.length} command{logs.length === 1 ? '' : 's'}
                            </Badge>
                          )}
                          <Badge variant={meeting.status === 'error' ? 'destructive' : 'muted'}>
                            {meeting.status}
                          </Badge>
                        </div>
                      </button>

                      {isExpanded && (
                        <div className="border-t border-fog-100 bg-fog-50/50 p-4 space-y-4">
                          <div>
                            <h4 className="text-xs font-medium uppercase tracking-wide text-fog-400 mb-2">Commands</h4>
                            {logs.length === 0 ? (
                              <p className="text-xs text-fog-500">No commands heard in this meeting.</p>
                            ) : (
                              <div className="space-y-2">
                                {logs.map((log) => (
                                  <Card key={log._id} className="rounded-xl">
                                    <CardContent className="p-3">
                                      <div className="flex items-center justify-between gap-2">
                                        <span className="text-xs text-fog-900 truncate">&ldquo;{log.command}&rdquo;</span>
                                        <Badge
                                          variant={ACTION_BADGE[log.status] || 'warning'}
                                          className="text-[11px] shrink-0"
                                        >
                                          {log.status.replace('_', ' ')}
                                        </Badge>
                                      </div>
                                      <div className="text-xs text-fog-500 mt-1.5">
                                        {log.intent.action}
                                        {log.result && ` · ${log.result}`}
                                        {log.errorMessage && ` · ${log.errorMessage}`}
                                      </div>
                                    </CardContent>
                                  </Card>
                                ))}
                              </div>
                            )}
                          </div>

                          {meeting.transcript && (
                            <div>
                              <h4 className="text-xs font-medium uppercase tracking-wide text-fog-400 mb-2">
                                Transcript
                              </h4>
                              <pre className="text-xs font-mono text-fog-600 whitespace-pre-wrap bg-white border border-fog-200 rounded-xl p-3 max-h-40 overflow-y-auto">
                                {meeting.transcript}
                              </pre>
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </Card>
        </section>

        {/* Voice command reference */}
        <Card className="bg-taro-50 border-taro-100">
          <CardContent>
            <h3 className="font-display font-semibold text-sm text-taro-900 mb-3">Things you can say</h3>
            <div className="grid sm:grid-cols-3 gap-3 text-xs">
              {[
                ['Post a message', '“Hey Taro, post ship it to general”'],
                ['Open a pull request', '“Hey Taro, make a pull request to fix the reports page”'],
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

        <p className="text-center text-xs text-fog-400 pb-4">
          Static demo snapshot · captured {captured} · no live backend
        </p>
      </div>
    </main>
  );
}
