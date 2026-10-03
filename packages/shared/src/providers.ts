// Every provider a workspace can bring its own key for. The API reads defaults
// from here and the dashboard renders its pickers from the same list, so adding
// a provider is one entry here plus an adapter in packages/api/src/services/llm.

export type LlmProviderId = 'anthropic' | 'openai' | 'google' | 'groq' | 'openrouter' | 'custom';
export type SttProviderId = 'groq' | 'openai' | 'server';

export interface ModelOption {
  id: string;
  label: string;
  note?: string;
}

export interface LlmProviderInfo {
  id: LlmProviderId;
  name: string;
  tagline: string;
  defaultModel: string;
  models: ModelOption[];
  keyUrl?: string;
  keyPlaceholder: string;
  // Custom endpoints need a base URL and an explicit model
  needsBaseUrl?: boolean;
  // The same key can also run transcription on this provider
  sttProvider?: SttProviderId;
}

export const LLM_PROVIDERS: LlmProviderInfo[] = [
  {
    id: 'anthropic',
    name: 'Anthropic',
    tagline: 'Claude models',
    defaultModel: 'claude-opus-5-5',
    models: [
      { id: 'claude-opus-5-5', label: 'Claude Opus 5.5', note: 'Most capable' },
      { id: 'claude-sonnet-5-5', label: 'Claude Sonnet 5.5', note: 'Balanced' },
      { id: 'claude-haiku-4-5', label: 'Claude Haiku 4.5', note: 'Fastest' },
    ],
    keyUrl: 'https://platform.claude.com/settings/keys',
    keyPlaceholder: 'sk-ant-...',
  },
  {
    id: 'openai',
    name: 'OpenAI',
    tagline: 'GPT models',
    defaultModel: 'gpt-5.4-mini',
    models: [
      { id: 'gpt-5.4-mini', label: 'GPT-5.4 mini', note: 'Fast' },
      { id: 'gpt-5.5', label: 'GPT-5.5', note: 'Most capable' },
    ],
    keyUrl: 'https://platform.openai.com/api-keys',
    keyPlaceholder: 'sk-...',
    sttProvider: 'openai',
  },
  {
    id: 'google',
    name: 'Google',
    tagline: 'Gemini models',
    defaultModel: 'gemini-flash-latest',
    models: [
      { id: 'gemini-flash-latest', label: 'Gemini Flash', note: 'Fast, always latest' },
      { id: 'gemini-pro-latest', label: 'Gemini Pro', note: 'Most capable' },
    ],
    keyUrl: 'https://aistudio.google.com/apikey',
    keyPlaceholder: 'AIza...',
  },
  {
    id: 'groq',
    name: 'Groq',
    tagline: 'Fast open models',
    defaultModel: 'openai/gpt-oss-120b',
    models: [
      { id: 'openai/gpt-oss-120b', label: 'GPT-OSS 120B', note: 'Recommended' },
      { id: 'openai/gpt-oss-20b', label: 'GPT-OSS 20B', note: 'Fastest' },
    ],
    keyUrl: 'https://console.groq.com/keys',
    keyPlaceholder: 'gsk_...',
    sttProvider: 'groq',
  },
  {
    id: 'openrouter',
    name: 'OpenRouter',
    tagline: 'Hundreds of models',
    defaultModel: 'openai/gpt-oss-120b',
    models: [
      { id: 'openai/gpt-oss-120b', label: 'GPT-OSS 120B', note: 'Low cost' },
      { id: 'anthropic/claude-sonnet-5.5', label: 'Claude Sonnet 5.5', note: 'Balanced' },
    ],
    keyUrl: 'https://openrouter.ai/settings/keys',
    keyPlaceholder: 'sk-or-...',
  },
  {
    id: 'custom',
    name: 'Custom',
    tagline: 'OpenAI-compatible',
    defaultModel: '',
    models: [],
    keyPlaceholder: 'Your API key',
    needsBaseUrl: true,
  },
];

export interface SttProviderInfo {
  id: SttProviderId;
  name: string;
  tagline: string;
  defaultModel: string;
  keyUrl?: string;
  keyPlaceholder: string;
  // Runs on the server operator's own infrastructure; needs no key
  operatorManaged?: boolean;
}

export const STT_PROVIDERS: SttProviderInfo[] = [
  {
    id: 'groq',
    name: 'Groq Whisper',
    tagline: 'Whisper on your Groq key',
    defaultModel: 'whisper-large-v3-turbo',
    keyUrl: 'https://console.groq.com/keys',
    keyPlaceholder: 'gsk_...',
  },
  {
    id: 'openai',
    name: 'OpenAI',
    tagline: 'Whisper on your OpenAI key',
    defaultModel: 'whisper-1',
    keyUrl: 'https://platform.openai.com/api-keys',
    keyPlaceholder: 'sk-...',
  },
  {
    id: 'server',
    name: 'Built-in',
    tagline: 'Hosted by this Taro server',
    defaultModel: '',
    keyPlaceholder: '',
    operatorManaged: true,
  },
];

export const MEETING_BOT_PROVIDER = {
  id: 'meetingbaas' as const,
  name: 'MeetingBaas',
  tagline: 'The bot that joins your Google Meet, Zoom, and Teams calls',
  keyUrl: 'https://meetingbaas.com',
  keyPlaceholder: 'mb-...',
};

export function getLlmProvider(id: string | undefined): LlmProviderInfo | undefined {
  return LLM_PROVIDERS.find((p) => p.id === id);
}

export function getSttProvider(id: string | undefined): SttProviderInfo | undefined {
  return STT_PROVIDERS.find((p) => p.id === id);
}
