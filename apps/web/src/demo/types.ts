// Shape of the frozen demo snapshot (packages/api/src/scripts/export-demo.ts). The generated module
// is a wide `as const` literal, so arrays here are readonly and adapt.ts can check the literal
// against these types. Fields the exporter gained later are optional: older snapshots still fit,
// and adapt.ts infers what they leave out.

import type { ActionOutcome, MeetingTally } from '@taro/shared';

export interface DemoParams {
  channel?: string;
  message?: string;
  title?: string;
  items?: readonly string[];
  body?: string;
  issueNumber?: number;
  labels?: readonly string[];
  assignees?: readonly string[];
  reviewers?: readonly string[];
  branch?: string;
  reason?: string;
  original?: string;
}

export interface DemoLog {
  _id: string;
  meetingId?: string;
  command: string;
  intent: { action: string; confidence?: number; params?: DemoParams; source?: string };
  status: string;
  outcome?: ActionOutcome;
  // The exact sentence Taro posted
  summary?: string;
  // The branch a pull request was opened from
  branch?: string;
  mode?: string;
  result?: string;
  errorMessage?: string;
  createdAt: string;
}

export interface DemoMeeting {
  _id: string;
  companyId: string;
  meetUrl: string;
  platform?: string;
  status: string;
  // How Taro was sent: slack, dashboard, and the ways in reserved for later
  source?: string;
  startedByName?: string;
  slackChannelName?: string;
  // Reserved for calendar event titles
  title?: string;
  errorCode?: string;
  errorMessage?: string;
  // Counted by GET /api/meetings; adapt.ts recounts from the exported requests either way
  tally?: MeetingTally;
  transcript?: string;
  // Exported only when no final transcript was saved
  liveTranscript?: string;
  createdAt: string;
  updatedAt: string;
  startedAt?: string;
  endedAt?: string;
}

export interface DemoDetail extends DemoMeeting {
  // Newest first, as the API returns them
  actionLogs: readonly DemoLog[];
}

export interface DemoSnapshot {
  capturedAt: string;
  // The IANA zone every time on /demo is shown in; America/Los_Angeles when the snapshot has none
  timeZone?: string;
  // The meeting /demo opens on
  featuredMeetingId?: string;
  company: {
    _id: string;
    name: string;
    // The Slack team domain ("vacantcourt"); older snapshots hold a web domain ("vacantcourt.com")
    domain?: string;
    onboardedAt?: string;
    createdAt: string;
    updatedAt: string;
  };
  slack: { connected: boolean; teamName?: string; connectedAt?: string };
  github: {
    connected: boolean;
    configured: boolean;
    accountLogin?: string;
    repo?: string;
    needsRepo?: boolean;
    enabledActions: readonly string[];
    connectedAt?: string;
  };
  meetings: readonly DemoMeeting[];
  details: Readonly<Record<string, DemoDetail>>;
}
