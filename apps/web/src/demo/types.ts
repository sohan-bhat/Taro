// Shape of the frozen demo snapshot (see scripts/export-demo.ts). The generated
// module is a wide `as const` literal, so the page casts it to these types.

export interface DemoLog {
  _id: string;
  command: string;
  intent: { action: string; source?: string };
  status: string;
  result?: string;
  errorMessage?: string;
}

export interface DemoMeeting {
  _id: string;
  companyId: string;
  meetUrl: string;
  status: string;
  startedByName?: string;
  transcript?: string;
  createdAt: string;
  updatedAt: string;
  startedAt?: string;
  endedAt?: string;
}

export interface DemoDetail extends DemoMeeting {
  actionLogs: DemoLog[];
}

export interface DemoSnapshot {
  demoKey: string;
  capturedAt: string;
  company: {
    _id: string;
    name: string;
    domain: string;
    licenseKey: string;
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
    needsRepo: boolean;
    enabledActions: string[];
    connectedAt?: string;
  };
  meetings: DemoMeeting[];
  details: Record<string, DemoDetail>;
}
