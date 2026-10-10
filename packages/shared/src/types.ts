// Public shapes shared by the API and the dashboard. Database documents live in
// packages/api/src/db/models and carry internal fields (encrypted keys, secret
// hashes) that never cross this boundary.

import type { LlmProviderId, SttProviderId } from './providers';
import type { TrackerId } from './constants';

export type WorkspaceRole = 'owner' | 'admin' | 'member';

// The accounts people sign in to Taro with.
export type SignInProvider = 'slack' | 'google';

// A Taro workspace is one Slack workspace (team), one company that signs in with Google
// (a Google Workspace domain), or one person's own Google account.
export interface Workspace {
  _id: string;
  name: string;
  // How people get in. Slack is required for Slack workspaces and optional for the others.
  signInWith: SignInProvider;
  // Google workspaces: the Google Workspace domain everyone here signs in from
  domain?: string;
  // One person's own Google account, so nobody else joins
  personal?: boolean;
  // The Slack team: who belongs, for a Slack workspace; the one connected, for the others
  slackTeamId?: string;
  slackTeamDomain?: string;
  botName: string;
  onboardedAt?: string;
  // False until someone adds Taro to Slack; that person becomes the owner. Google workspaces are
  // claimed by the first person to sign in.
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
  // Not set up by the workspace, so it runs on the server's shared Groq key
  shared?: boolean;
  provider?: LlmProviderId;
  model?: string;
  baseUrl?: string;
}

export interface SttSettings extends KeyStatus {
  // Not set up by the workspace, so it runs on the server's shared Groq key
  shared?: boolean;
  provider?: SttProviderId;
  model?: string;
  // True when transcription runs on the AI model's key (same provider)
  usesLlmKey?: boolean;
}

export interface ProviderSettings {
  meetingBot: MeetingBotSettings;
  llm: LlmSettings;
  stt: SttSettings;
  // When the server shares a Groq key: how many meetings a month it covers, and how many this workspace used
  free?: { meetingsPerMonth: number; usedThisMonth: number };
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

// A Linear team or a Jira project new tickets can go to.
export interface TrackerSpace {
  id: string;
  // The prefix on its tickets: ENG in ENG-123
  key: string;
  name: string;
}

// Linear, installed as the Taro app, or Jira, through the Taro app for Jira. Shared by workspace.
export interface TrackerStatus {
  connected: boolean;
  // False when the server can't connect it (Linear's app credentials or Jira's install link aren't set)
  configured: boolean;
  // The Linear workspace or the Jira site
  siteName?: string;
  siteUrl?: string;
  // Teams or projects Taro can file in, and the one new tickets go to
  spaces?: TrackerSpace[];
  defaultSpace?: string;
  enabledActions?: string[];
  // Linear stopped honoring Taro's access, or the Jira key was replaced or the app uninstalled
  needsReconnect?: boolean;
  connectedAt?: string;
}

// A GitHub account the person can connect, offered when they have more than one.
export interface GithubAccountChoice {
  installationId: string;
  accountLogin: string;
  repoCount: number; // repos there they can push to
}

// Which meetings on a connected Google Calendar Taro joins on its own: every one with a video link
// the person hasn't declined, or only the ones they organize.
export type GoogleCalendarJoinMode = 'all' | 'organizer';

// The signed-in person's own Google Calendar connection. Personal: each member connects their own.
export interface GoogleCalendarStatus {
  connected: boolean;
  // Google stopped letting Taro read the calendar (access revoked or expired); nothing syncs until they reconnect
  needsReconnect?: boolean;
  // The Google account it reads
  email?: string;
  connectedAt?: string;
  lastSyncedAt?: string;
  // "Join my meetings automatically", and which ones
  autoJoin?: boolean;
  joinMode?: GoogleCalendarJoinMode;
}

// Everything the dashboard needs to render, in one request.
export interface WorkspaceOverview {
  workspace: Workspace;
  me: User;
  providers: ProviderSettings;
  slack: SlackStatus;
  github: GithubStatus;
  linear: TrackerStatus;
  jira: TrackerStatus;
  // With both connected: where a ticket goes when nobody says which
  ticketTracker?: TrackerId;
  // Set when the server can connect Google Calendars: the signed-in person's own connection
  googleCalendar?: GoogleCalendarStatus;
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
  // calendar: an invitation to Taro's address. google_calendar: a member's connected Google Calendar.
  // slack_command is reserved for the next way in.
  source?: 'slack' | 'dashboard' | 'calendar' | 'google_calendar' | 'slack_command' | 'extension';
  startedByName?: string;
  slackChannelName?: string; // resolved at launch, for "Priya, from #product"
  title?: string; // the calendar event's title
  errorMessage?: string;
  errorCode?: string; // MeetingBaas error_code from bot.failed
  tally?: MeetingTally; // filled in by GET /api/meetings
  archivedAt?: string;
  transcript?: string;
  liveTranscript?: string;
  // While joining: MeetingBaas is still starting the bot, or it's asking to be let in (since lobbyAt)
  joinStage?: 'starting' | 'lobby';
  lobbyAt?: string;
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
  ticket?: string; // a Linear or Jira ticket key, like ENG-123, or just its number
  tracker?: TrackerId; // Linear or Jira, when they named one; the executor stores the one it used
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
  | 'create_ticket'
  | 'comment_ticket'
  | 'close_ticket'
  | 'reopen_ticket'
  | 'assign_ticket'
  | 'label_ticket'
  | 'unknown';

export interface ParsedIntent {
  action: IntentAction;
  confidence: number;
  params: IntentParams;
  // Which provider produced this; 'fallback_regex' means the AI call failed.
  source?: LlmProviderId | 'fallback_regex';
  // Further actions asked for in the same breath ("merge it and open a pull request"), in the order said
  then?: ParsedIntent[];
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
  // True once the server has Google's client ID and secret
  googleSignIn: boolean;
  githubApp: boolean;
  // Linear's app credentials, and the Jira app's install link; unset means off
  linear?: boolean;
  jira?: boolean;
  serverStt: boolean;
  // Calendar invitations, Connect Google Calendar, and the Google Meet button; unset means off.
  calendarInvites?: boolean;
  googleCalendar?: boolean;
  meetExtension?: boolean;
}

// A meeting Taro will join from a calendar, before it starts. One per occurrence of a series.
export interface UpcomingMeeting {
  _id: string;
  title?: string;
  startsAt: string;
  endsAt: string;
  meetUrl: string;
  platform: MeetingPlatform;
  // Where Taro heard about it: an invitation to its address, or a connected Google Calendar (the
  // viewer's own; each person sees only the meetings from their own calendar)
  source?: 'invite' | 'google';
  // scheduled: Taro joins at the start. needs_approval: an owner or admin approves it first.
  // skipped: someone skipped this one occurrence.
  status: 'scheduled' | 'needs_approval' | 'skipped';
  recurring: boolean;
  organizerName?: string;
  organizerEmail?: string;
  // For meetings waiting for approval: the address the invitation came from
  sentBy?: string;
  // Why Taro can't join as things stand: missing setup, or MeetingBaas refusing to schedule it
  problem?: string;
}
