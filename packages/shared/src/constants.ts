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
  UNKNOWN: 'unknown',
} as const;

// GitHub capabilities a company can turn on/off for Taro; the GitHub App permission is the ceiling, this is the company's policy within it.
export const GITHUB_CAPABILITIES = [
  {
    action: 'create_github_issue',
    label: 'Create issues',
    description: 'File new issues from voice commands',
    permission: 'Issues: Read and write',
  },
  {
    action: 'comment_github',
    label: 'Comment on issues & pull requests',
    description: 'Add a comment to an issue or PR by number',
    permission: 'Issues: Read and write',
  },
  {
    action: 'close_github_issue',
    label: 'Close issues',
    description: 'Close an issue by number',
    permission: 'Issues: Read and write',
  },
  {
    action: 'reopen_github_issue',
    label: 'Reopen issues',
    description: 'Reopen a closed issue by number',
    permission: 'Issues: Read and write',
  },
  {
    action: 'label_github_issue',
    label: 'Label issues',
    description: 'Add labels to an issue',
    permission: 'Issues: Read and write',
  },
  {
    action: 'assign_github_issue',
    label: 'Assign issues',
    description: 'Assign teammates to an issue',
    permission: 'Issues: Read and write',
  },
  {
    action: 'close_pull_request',
    label: 'Close pull requests',
    description: 'Close a PR by number',
    permission: 'Pull requests: Read and write',
  },
  {
    action: 'merge_pull_request',
    label: 'Merge pull requests',
    description: 'Merge a PR by number (powerful, off by default)',
    permission: 'Pull requests + Contents: Read and write',
  },
  {
    action: 'request_github_review',
    label: 'Request PR reviews',
    description: 'Request reviewers on a pull request',
    permission: 'Pull requests: Read and write',
  },
  {
    action: 'create_pull_request',
    label: 'Create pull requests',
    description: 'Open a new branch and pull request from a meeting request',
    permission: 'Contents + Pull requests: Read and write',
  },
] as const;

export type GithubAction = (typeof GITHUB_CAPABILITIES)[number]['action'];

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
  COMPANIES: '/api/companies',
  MEETINGS: '/api/meetings',
} as const;
