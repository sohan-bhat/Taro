export const WAKE_WORD = 'hey taro';

// Common speech-to-text misrecognitions of the wake word, matched against normalized transcript text.
export const WAKE_WORD_VARIATIONS = [
  'hey taro',
  'hey tarot',
  'hey tarro',
  'hey taru',
  'hey tara',
  'hey tero', // observed from sherpa-onnx streaming zipformer
  'hey terro',
  'hey terror', // zipformer favors real English words
  'hey toro',
  'hey terra',
  'hey tarrow',
] as const;

export const INTENTS = {
  POST_MESSAGE: 'post_message',
  CREATE_TODO_LIST: 'create_todo_list',
  CREATE_GITHUB_ISSUE: 'create_github_issue',
  COMMENT_GITHUB: 'comment_github',
  CLOSE_GITHUB_ISSUE: 'close_github_issue',
  REOPEN_GITHUB_ISSUE: 'reopen_github_issue',
  LABEL_GITHUB_ISSUE: 'label_github_issue',
  ASSIGN_GITHUB_ISSUE: 'assign_github_issue',
  CLOSE_PULL_REQUEST: 'close_pull_request',
  MERGE_PULL_REQUEST: 'merge_pull_request',
  REQUEST_GITHUB_REVIEW: 'request_github_review',
  CREATE_PULL_REQUEST: 'create_pull_request',
  CREATE_TICKET: 'create_ticket',
  COMMENT_TICKET: 'comment_ticket',
  CLOSE_TICKET: 'close_ticket',
  REOPEN_TICKET: 'reopen_ticket',
  ASSIGN_TICKET: 'assign_ticket',
  LABEL_TICKET: 'label_ticket',
  UNKNOWN: 'unknown',
} as const;

// Where tickets go: Linear, Jira, or both. A workspace can connect either one or both.
export const TRACKERS = {
  linear: 'Linear',
  jira: 'Jira',
} as const;

export type TrackerId = keyof typeof TRACKERS;

export const isTrackerId = (v: unknown): v is TrackerId => v === 'linear' || v === 'jira';

// Ticket actions a workspace can turn on or off for each tracker, in the order the dashboard lists them.
export const TICKET_CAPABILITIES = [
  { action: 'create_ticket', label: 'Create tickets', description: 'File new tickets from what people ask for', gerund: 'Filing tickets' },
  { action: 'comment_ticket', label: 'Comment on tickets', description: 'Add a comment to a ticket by its key', gerund: 'Commenting on tickets' },
  { action: 'assign_ticket', label: 'Assign tickets', description: 'Assign a teammate to a ticket', gerund: 'Assigning tickets' },
  { action: 'label_ticket', label: 'Label tickets', description: 'Add labels to a ticket', gerund: 'Labeling tickets' },
  { action: 'close_ticket', label: 'Close tickets', description: 'Move a ticket to done', gerund: 'Closing tickets' },
  { action: 'reopen_ticket', label: 'Reopen tickets', description: 'Move a done ticket back to to do', gerund: 'Reopening tickets' },
] as const;

export type TicketAction = (typeof TICKET_CAPABILITIES)[number]['action'];

export const isTicketAction = (action: string): action is TicketAction =>
  TICKET_CAPABILITIES.some((c) => c.action === action);

// Filing and commenting add to a tracker without changing anyone's work; the rest stay opt-in.
export const DEFAULT_TICKET_ACTIONS: TicketAction[] = ['create_ticket', 'comment_ticket'];

// GitHub capabilities a company can turn on/off for Taro; the GitHub App permission is the ceiling, this is the company's policy within it.
// In the order the dashboard lists them. `gerund` names a refused action: "Merging is turned off for this workspace."
export const GITHUB_CAPABILITIES = [
  {
    action: 'create_github_issue',
    label: 'Create issues',
    description: 'File new issues from what people ask for',
    gerund: 'Filing issues',
    permission: 'Issues: Read and write',
  },
  {
    action: 'comment_github',
    label: 'Comment on issues and pull requests',
    description: 'Add a comment by number',
    gerund: 'Commenting',
    permission: 'Issues: Read and write',
  },
  {
    action: 'create_pull_request',
    label: 'Open pull requests',
    description: 'Make a branch, commit a short plan, and open a pull request',
    gerund: 'Opening pull requests',
    permission: 'Contents + Pull requests: Read and write',
  },
  {
    action: 'label_github_issue',
    label: 'Label issues',
    description: 'Add labels to an issue',
    gerund: 'Labeling issues',
    permission: 'Issues: Read and write',
  },
  {
    action: 'assign_github_issue',
    label: 'Assign issues',
    description: 'Assign teammates to an issue',
    gerund: 'Assigning issues',
    permission: 'Issues: Read and write',
  },
  {
    action: 'request_github_review',
    label: 'Request reviews',
    description: 'Ask teammates to review a pull request',
    gerund: 'Requesting reviews',
    permission: 'Pull requests: Read and write',
  },
  {
    action: 'close_github_issue',
    label: 'Close issues',
    description: 'Close an issue by number',
    gerund: 'Closing issues',
    permission: 'Issues: Read and write',
  },
  {
    action: 'reopen_github_issue',
    label: 'Reopen issues',
    description: 'Reopen a closed issue by number',
    gerund: 'Reopening issues',
    permission: 'Issues: Read and write',
  },
  {
    action: 'close_pull_request',
    label: 'Close pull requests',
    description: 'Close a pull request by number',
    gerund: 'Closing pull requests',
    permission: 'Pull requests: Read and write',
  },
  {
    action: 'merge_pull_request',
    label: 'Merge pull requests',
    description: 'Merge a pull request into its base branch',
    gerund: 'Merging',
    permission: 'Pull requests + Contents: Read and write',
  },
] as const;

export type GithubAction = (typeof GITHUB_CAPABILITIES)[number]['action'];

export const isGithubAction = (action: string): action is GithubAction =>
  GITHUB_CAPABILITIES.some((c) => c.action === action);

// Safe, non-destructive defaults; a PR is just a proposal against a new branch, it never touches main. Powerful actions like merge and close stay opt-in.
export const DEFAULT_GITHUB_ACTIONS: GithubAction[] = [
  'create_github_issue',
  'comment_github',
  'create_pull_request',
];

export const MEETING_STATUS = {
  PENDING: 'pending',
  JOINING: 'joining',
  ACTIVE: 'active',
  ENDED: 'ended',
  ERROR: 'error',
} as const;

export const API_ROUTES = {
  HEALTH: '/health',
  READY: '/ready',
} as const;

// Meetings Taro can join, matched against links posted in Slack or pasted in the dashboard.
export const MEETING_PLATFORMS = {
  google_meet: 'Google Meet',
  zoom: 'Zoom',
  teams: 'Microsoft Teams',
} as const;
