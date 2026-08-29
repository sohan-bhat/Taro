// Company registered with Taro
export interface Company {
  _id: string;
  name: string;
  domain: string; // e.g. "company.com", used to detect meetings
  licenseKey?: string; // e.g. "TARO-K3NF-8WPQ-M2XZ", how a company signs back in
  onboardedAt?: Date; // set once first-run onboarding completes
  createdAt: Date;
  updatedAt: Date;
}

// Slack workspace connection
export interface SlackConnection {
  _id: string;
  companyId: string;
  teamId: string;
  teamName: string;
  accessToken: string; // Encrypted
  botUserId: string;
  createdAt: Date;
}

// Issued unclaimed, then a company activates its workspace with it; companyId is set once claimed.
export interface License {
  _id: string;
  key: string; // "TARO-XXXX-XXXX-XXXX"
  companyId?: string | null;
  claimedAt?: Date;
  revokedAt?: Date; // entitlement kill switch: set = workspace loses access
  createdAt: Date;
}

// GitHub App installation: Taro acts as its own bot (`taro[bot]`), never through a person's account.
export interface GithubConnection {
  _id: string;
  companyId: string;
  installationId: string;
  accountLogin?: string; // org or user the app is installed on
  repo?: string; // default "owner/name" issues are filed in
  // Subset of GITHUB_CAPABILITIES the company allows; empty/undefined falls back to DEFAULT_GITHUB_ACTIONS.
  enabledActions?: string[];
  disconnectedAt?: Date; // soft-disconnected: keep the installation for one-click reconnect
  createdAt: Date;
}

// Active meeting session
export interface Meeting {
  _id: string;
  companyId: string;
  meetUrl: string;
  status: 'pending' | 'joining' | 'active' | 'ended' | 'error';
  botId?: string; // MeetingBaas bot ID
  // Where the meeting link was detected, so results can be posted back in the thread
  slackChannelId?: string;
  slackThreadTs?: string;
  // Who posted the Meet link that triggered this meeting (Slack display name)
  startedByName?: string;
  startedByUserId?: string;
  // Set when cleared from the main history; archived meetings are kept forever
  archivedAt?: Date;
  // Full transcript captured when the meeting completes (for debugging & display)
  transcript?: string;
  // What the realtime ASR has heard so far (updated during the call)
  liveTranscript?: string;
  // Last time meeting audio reached the realtime pipeline (liveness signal)
  lastAudioAt?: Date;
  // Set atomically when command processing starts, to prevent double execution on webhook retries
  commandsProcessedAt?: Date;
  startedAt?: Date;
  endedAt?: Date;
  createdAt: Date;
}

// Log of actions taken by Taro
export interface ActionLog {
  _id: string;
  meetingId: string;
  companyId: string;
  command: string; // Raw transcript
  intent: ParsedIntent;
  status: 'success' | 'failed' | 'clarification_needed';
  // 'live' runs mid-meeting from the realtime audio stream, 'post_meeting' from the end-of-meeting transcript webhook.
  mode?: 'live' | 'post_meeting';
  result?: string;
  errorMessage?: string;
  createdAt: Date;
}

// Parameters extracted from a voice command
export interface IntentParams {
  channel?: string;
  message?: string;
  title?: string;
  items?: string[];
  body?: string; // GitHub issue body or comment text
  issueNumber?: number; // target issue or PR number
  labels?: string[];
  assignees?: string[]; // GitHub logins to assign
  reviewers?: string[]; // GitHub logins to request review from
  branch?: string; // new branch name for a pull request
  reason?: string; // for 'unknown': why Taro can't do it / what it can do instead
  original?: string;
}

// Parsed intent from the LLM, or the regex fallback
export interface ParsedIntent {
  action:
    | 'post_message'
    | 'create_todo_list'
    | 'create_github_issue'
    | 'comment_github'
    | 'close_github_issue'
    | 'reopen_github_issue'
    | 'label_github_issue'
    | 'assign_github_issue'
    | 'close_pull_request'
    | 'merge_pull_request'
    | 'request_github_review'
    | 'create_pull_request'
    | 'unknown';
  confidence: number;
  params: IntentParams;
  // Which parser produced this; 'fallback_regex' means the LLM failed and should be investigated.
  source?: 'groq' | 'gemini' | 'fallback_regex';
}

export type IntegrationType = 'slack' | 'github' | 'google_calendar' | 'microsoft_teams' | 'zoom';

// Integration metadata for UI
export interface IntegrationInfo {
  type: IntegrationType;
  name: string;
  description: string;
  available: boolean; // Whether it's implemented
}

export const AVAILABLE_INTEGRATIONS: IntegrationInfo[] = [
  {
    type: 'slack',
    name: 'Slack',
    description: 'Detects meeting links in channels and posts Taro\'s results back',
    available: true,
  },
  {
    type: 'github',
    name: 'GitHub',
    description: 'File issues in your repo by voice ("Hey Taro, create an issue about...")',
    available: true,
  },
  {
    type: 'google_calendar',
    name: 'Google Calendar',
    description: 'Auto-join scheduled meetings from calendar invites',
    available: false,
  },
];
