// Company registered with Taro
export interface Company {
  _id: string;
  name: string;
  domain: string; // e.g., "company.com" - used to detect meetings
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

// Active meeting session
export interface Meeting {
  _id: string;
  companyId: string;
  meetUrl: string;
  status: 'pending' | 'joining' | 'active' | 'ended' | 'error';
  botId?: string; // MeetingBaas bot ID
  startedAt?: Date;
  endedAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

// Log of actions taken by Taro
export interface ActionLog {
  _id: string;
  meetingId: string;
  companyId: string;
  command: string; // Raw transcript
  intent: ParsedIntent;
  status: 'success' | 'failed' | 'clarification_needed';
  result?: string;
  errorMessage?: string;
  createdAt: Date;
}

// Parsed intent from Gemini
export interface ParsedIntent {
  action: 'post_message' | 'create_task' | 'unknown';
  confidence: number;
  params: Record<string, string>;
  // For post_message: { channel: string, message: string }
  // For create_task: { channel: string, task: string }
}

// Available integration types
export type IntegrationType = 'slack' | 'google_calendar' | 'microsoft_teams' | 'zoom';

// Integration metadata for UI
export interface IntegrationInfo {
  type: IntegrationType;
  name: string;
  description: string;
  available: boolean; // Whether it's implemented
}

// Available integrations for companies to choose from
export const AVAILABLE_INTEGRATIONS: IntegrationInfo[] = [
  {
    type: 'slack',
    name: 'Slack',
    description: 'Listen for meeting links in Slack channels',
    available: true,
  },
];
