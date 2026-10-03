// Public shapes shared by the API and the dashboard. Database documents live in
// packages/api/src/db/models and carry internal fields (encrypted keys, secret
// hashes) that never cross this boundary.

import type { LlmProviderId, SttProviderId } from './providers';

export type WorkspaceRole = 'owner' | 'admin' | 'member';

// A Taro workspace maps one-to-one to a Slack workspace (team).
export interface Workspace {
  _id: string;
  name: string;
  slackTeamId?: string;
  slackTeamDomain?: string;
  botName: string;
  onboardedAt?: string;
  // False until someone adds Taro to Slack; that person becomes the owner.
  claimed: boolean;
  createdAt: string;
}

export interface User {
  _id: string;
  name: string;
  email?: string;
  avatarUrl?: string;
  role: WorkspaceRole;
  lastSeenAt?: string;
  removed?: boolean; // an owner removed them; they can't sign in until restored
}

// Masked view of a stored provider key; the key itself is never sent back.
export interface KeyStatus {
  configured: boolean;
  keyHint?: string; // e.g. "sk-ant-…a1b2"
  validatedAt?: string;
}

export interface MeetingBotSettings extends KeyStatus {
  provider: 'meetingbaas';
}

export interface LlmSettings extends KeyStatus {
  provider?: LlmProviderId;
  model?: string;
  baseUrl?: string;
}

export interface SttSettings extends KeyStatus {
  provider?: SttProviderId;
  model?: string;
  // True when transcription runs on the AI model's key (same provider)
  usesLlmKey?: boolean;
}

export interface ProviderSettings {
  meetingBot: MeetingBotSettings;
  llm: LlmSettings;
  stt: SttSettings;
}

export interface SlackStatus {
  connected: boolean;
  teamName?: string;
  connectedAt?: string;
}

export interface GithubStatus {
  connected: boolean;
  configured: boolean; // false when the server has no GitHub App credentials
  accountLogin?: string;
  repo?: string;
  needsRepo?: boolean;
  enabledActions?: string[];
  reconnectable?: boolean; // a prior installation exists and can be reconnected in one click
  connectedAt?: string;
}

// A GitHub account the person can connect, offered when they have more than one.
export interface GithubAccountChoice {
  installationId: string;
  accountLogin: string;
  repoCount: number; // repos there they can push to
}

// Everything the dashboard needs to render, in one request.
export interface WorkspaceOverview {
  workspace: Workspace;
  me: User;
  providers: ProviderSettings;
  slack: SlackStatus;
  github: GithubStatus;
  ready: {
    meetingBot: boolean;
    llm: boolean;
    stt: boolean;
    slack: boolean;
    // All required pieces are in place, so Taro can join meetings
    canJoinMeetings: boolean;
  };
}

export type MeetingPlatform = 'google_meet' | 'zoom' | 'teams';

export type MeetingStatus = 'pending' | 'joining' | 'active' | 'ended' | 'error';

// Requests in one meeting, counted by outcome.
export interface MeetingTally {
  done: number;
  needsYou: number;
  turnedOff: number;
  failed: number;
}

export interface Meeting {
  _id: string;
  meetUrl: string;
  platform?: MeetingPlatform;
  status: MeetingStatus;
  // calendar, slack_command, and extension are reserved for the next ways in.
  source?: 'slack' | 'dashboard' | 'calendar' | 'slack_command' | 'extension';
  startedByName?: string;
  slackChannelName?: string; // resolved at launch, for "Priya, from #product"
  title?: string; // reserved for calendar event titles
  errorMessage?: string;
  errorCode?: string; // MeetingBaas error_code from bot.failed
  tally?: MeetingTally; // filled in by GET /api/meetings
  archivedAt?: string;
  transcript?: string;
  liveTranscript?: string;
  lastAudioAt?: string;
  startedAt?: string;
  endedAt?: string;
  createdAt: string;
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

export type IntentAction =
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

export interface ParsedIntent {
  action: IntentAction;
  confidence: number;
  params: IntentParams;
  // Which provider produced this; 'fallback_regex' means the AI call failed.
  source?: LlmProviderId | 'fallback_regex';
}

// How a request ended, as Taro reported it. Older logs only have `status`.
export type ActionOutcome = 'done' | 'needs_you' | 'turned_off' | 'failed';

export interface ActionLog {
  _id: string;
  meetingId: string;
  command: string;
  intent: ParsedIntent;
  status: 'success' | 'failed' | 'clarification_needed';
  outcome?: ActionOutcome;
  summary?: string; // the exact sentence Taro posted
  branch?: string; // the branch a pull request was opened from
  // 'live' runs mid-meeting from the audio stream, 'post_meeting' from the end-of-call sweep.
  mode?: 'live' | 'post_meeting';
  result?: string;
  errorMessage?: string;
  createdAt: string;
}

export interface MeetingDetail extends Meeting {
  actionLogs: ActionLog[];
}

// A signed-in browser: a dashboard tab, or the Taro browser extension.
export interface ConnectedSession {
  _id: string;
  kind: 'web' | 'extension';
  label?: string;
  createdAt: string;
  lastUsedAt?: string;
  current: boolean;
}

// What the server operator has configured, so the UI can hide what isn't available.
export interface ServerMeta {
  slackSignIn: boolean;
  githubApp: boolean;
  serverStt: boolean;
  // Reserved for calendar invitations and the Google Meet button; unset means off.
  calendarInvites?: boolean;
  meetExtension?: boolean;
}
