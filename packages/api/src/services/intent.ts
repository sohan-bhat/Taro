import { GoogleGenAI, Type } from '@google/genai';
import type { ParsedIntent } from '@taro/shared';
import { INTENTS } from '@taro/shared';

// Fast, cheap, and safely past the Oct 2026 gemini-2.5 shutdown
const DEFAULT_MODEL = 'gemini-3.6-flash';

let client: GoogleGenAI | null = null;
function getClient(): GoogleGenAI | null {
  if (!process.env.GOOGLE_API_KEY) return null;
  if (!client) {
    client = new GoogleGenAI({ apiKey: process.env.GOOGLE_API_KEY });
  }
  return client;
}

// Simple regex-based intent parser - fallback when Gemini is unavailable
export function parseIntentSimple(command: string): ParsedIntent {
  const lower = command.toLowerCase().trim();

  // Pattern: "make/create a todo list in Y about X, X and X"
  // ("total list" = common ASR misrecognition of "todo list")
  const todoMatch = lower.match(
    /(?:make|create|add)\s+(?:a\s+)?(?:to[- ]?do|total)\s*list\s+(?:in|to)\s+(?:the\s+)?#?([\w-]+)\s*(?:channel\s+)?about\s+(.+)/
  );
  if (todoMatch) {
    const items = todoMatch[2]
      .split(/,|\band\b|\bthen\b|\balso\b/)
      .map((s) => s.replace(/[.?!]+$/, '').trim())
      .filter(Boolean);
    return {
      action: INTENTS.CREATE_TODO_LIST,
      confidence: 0.85,
      params: { channel: todoMatch[1].trim(), items },
      source: 'fallback_regex',
    };
  }

  // Pattern: "comment on issue/PR N saying/that X"
  const commentMatch = lower.match(
    /comment\s+on\s+(?:issue|pull\s*request|pr)\s*#?\s*(\d+)\s+(?:saying|that|with)?\s*(.+)/
  );
  if (commentMatch) {
    return {
      action: INTENTS.COMMENT_GITHUB,
      confidence: 0.8,
      params: {
        issueNumber: parseInt(commentMatch[1], 10),
        body: commentMatch[2].replace(/[.?!]+$/, '').trim(),
      },
      source: 'fallback_regex',
    };
  }

  // Pattern: "close/reopen issue N", "close/merge PR N"
  const prMatch = lower.match(/(close|merge)\s+(?:pull\s*request|pr)\s*#?\s*(\d+)/);
  if (prMatch) {
    return {
      action: prMatch[1] === 'merge' ? INTENTS.MERGE_PULL_REQUEST : INTENTS.CLOSE_PULL_REQUEST,
      confidence: 0.85,
      params: { issueNumber: parseInt(prMatch[2], 10) },
      source: 'fallback_regex',
    };
  }
  const stateMatch = lower.match(/(close|reopen)\s+(?:issue|ticket)\s*#?\s*(\d+)/);
  if (stateMatch) {
    return {
      action: stateMatch[1] === 'reopen' ? INTENTS.REOPEN_GITHUB_ISSUE : INTENTS.CLOSE_GITHUB_ISSUE,
      confidence: 0.85,
      params: { issueNumber: parseInt(stateMatch[2], 10) },
      source: 'fallback_regex',
    };
  }

  // Pattern: "create/file/open an issue about X"
  // ("get hub"/"good hub" = common ASR misrecognitions of "github")
  const issueMatch = lower.match(
    /(?:create|make|open|file|raise|add)\s+(?:a\s+|an\s+)?(?:new\s+)?(?:github\s+|git\s*hub\s+|get\s*hub\s+|good\s*hub\s+)?issue\s+(?:about|for|saying|that|titled|called|regarding)?\s*(.+)/
  );
  if (issueMatch) {
    const title = issueMatch[1].replace(/[.?!]+$/, '').trim();
    return {
      action: INTENTS.CREATE_GITHUB_ISSUE,
      confidence: 0.85,
      params: { title: title.charAt(0).toUpperCase() + title.slice(1) },
      source: 'fallback_regex',
    };
  }

  // Pattern: "post X to Y" or "send X to Y"
  const postMatch = lower.match(/(?:post|send|say)\s+(.+?)\s+(?:to|in)\s+(?:the\s+)?#?(\w[\w-]*)/);
  if (postMatch) {
    return {
      action: INTENTS.POST_MESSAGE,
      confidence: 0.9,
      params: {
        message: postMatch[1].trim(),
        channel: postMatch[2].trim(),
      },
      source: 'fallback_regex',
    };
  }

  // Pattern: "message Y saying X" or "message Y with X"
  const messageMatch = lower.match(/message\s+(?:the\s+)?#?(\w[\w-]*)\s+(?:saying|with)\s+(.+)/);
  if (messageMatch) {
    return {
      action: INTENTS.POST_MESSAGE,
      confidence: 0.85,
      params: {
        channel: messageMatch[1].trim(),
        message: messageMatch[2].trim(),
      },
      source: 'fallback_regex',
    };
  }

  // Unknown intent
  return {
    action: INTENTS.UNKNOWN,
    confidence: 0,
    params: { original: command },
    source: 'fallback_regex',
  };
}

// Structured output schema - Gemini is forced to return exactly this shape
const RESPONSE_SCHEMA = {
  type: Type.OBJECT,
  properties: {
    action: {
      type: Type.STRING,
      enum: [
        'post_message',
        'create_todo_list',
        'create_github_issue',
        'comment_github',
        'close_github_issue',
        'reopen_github_issue',
        'label_github_issue',
        'assign_github_issue',
        'close_pull_request',
        'merge_pull_request',
        'request_github_review',
        'create_pull_request',
        'unknown',
      ],
    },
    confidence: { type: Type.NUMBER },
    channel: { type: Type.STRING },
    message: { type: Type.STRING },
    title: { type: Type.STRING },
    items: { type: Type.ARRAY, items: { type: Type.STRING } },
    body: { type: Type.STRING },
    issueNumber: { type: Type.NUMBER },
    labels: { type: Type.ARRAY, items: { type: Type.STRING } },
    assignees: { type: Type.ARRAY, items: { type: Type.STRING } },
    reviewers: { type: Type.ARRAY, items: { type: Type.STRING } },
    branch: { type: Type.STRING },
    reason: { type: Type.STRING },
  },
  required: ['action', 'confidence'],
};

const SYSTEM_PROMPT = `You are Taro, a voice-activated meeting assistant. You receive raw speech-to-text of a spoken command and extract the intent.

You are given the recent MEETING TRANSCRIPT plus the specific COMMAND the user spoke after saying "Hey Taro". Reason over the whole conversation like a smart teammate would, not just the command words in isolation.

The text comes from meeting audio transcription, so expect: missing punctuation, filler words ("um", "like"), misheard words, and trailing unrelated conversation.

Use the transcript to resolve references. If the command says "that", "it", "the issue we discussed", "what I mentioned earlier", "the bug from before", or is otherwise underspecified, look back through the transcript and fill in the specifics yourself (the real bug, the real topic, the actual issue/PR number if it was said). Compose real content grounded in what was actually discussed; never echo the raw transcript and never invent facts that were not said.

Common misrecognitions to interpret correctly: "todo list" often appears as "total list", "to do list", or "to-do list"; "github" often appears as "git hub", "get hub", or "good hub"; channel names may be spelled out ("x y z" = "xyz") or split ("general chat" = "general-chat" if that reads as one channel name).

Actions:
- "post_message": user wants a message posted to a Slack channel. Extract "channel" and "message".
- "create_todo_list": user wants a todo list created in a Slack channel. Extract "channel", optional "title", and "items" (each distinct task as one item).
- "create_github_issue": user wants a GitHub issue filed (words like "issue", "bug", "ticket"). Extract "title" (short imperative summary) and optional "body" (extra detail).
- "comment_github": user wants to comment on an existing issue or pull request. Extract "issueNumber" (the number they reference, e.g. "issue 12", "PR number 5", "pull request 8") and "body" (the comment text).
- "close_github_issue": user wants to close an issue. Extract "issueNumber".
- "reopen_github_issue": user wants to reopen a closed issue. Extract "issueNumber".
- "label_github_issue": user wants to add labels to an issue. Extract "issueNumber" and "labels" (array).
- "assign_github_issue": user wants to assign teammates to an issue. Extract "issueNumber" and "assignees" (array of GitHub usernames as spoken).
- "close_pull_request": user wants to close a pull request. Extract "issueNumber" (the PR number).
- "merge_pull_request": user wants to merge a pull request. Extract "issueNumber" (the PR number).
- "request_github_review": user wants to request reviewers on a PR. Extract "issueNumber" (PR number) and "reviewers" (array of usernames).
- "create_pull_request": user wants to open a NEW pull request (often phrased as "make a branch and a pull request", "open a PR for..."). Extract "title" (short imperative summary) and optional "body" (detail from the meeting) and optional "branch" (a branch name if they said one). Taro creates the branch and PR itself.
There is one configured repo, so never extract a repo or channel for GitHub actions.
- "unknown": use ONLY when you genuinely cannot map the request to an action above. Whenever you return "unknown" you MUST set "reason" to a helpful, specific sentence: say what you understood the user wanted, and either what is missing (e.g. "which channel should I post to?") or why you cannot do it and the closest thing you can. Never return a bare unknown with no reason. Prefer to actually pick an action and fill in details from the transcript rather than giving up.

WRITING CONTENT (produce final, publishable content, never placeholders or raw transcript):
- create_github_issue / create_pull_request: "title" is a short imperative summary. "body" is GitHub-flavored markdown: a "## Summary" (2-3 sentences describing the problem or request from the discussion) and, when specifics were mentioned, a "## Details" section (browsers, errors, pages, people). For a PR use "## Changes" as a short checklist. Never paste the raw transcript; write it up properly. Never invent facts that were not said.
- comment_github: "body" is a clean, professional comment.
- post_message: if the user dictated a message, clean it up; if they asked you to WRITE something (an opinion, statement, announcement, summary), actually author it well for a workplace Slack channel.
- create_todo_list: "items" are clean, deduplicated imperative tasks.

Channel rules:
- Slack channel names are lowercase with hyphens. Normalize: "the Engineering channel" -> "engineering", "X Y Z channel" (spelled out letters) -> "xyz", "project updates" -> "project-updates" only if clearly one channel name.
- Never include "#" or the word "channel" in the channel value.

Examples:
Input: "post hello everyone to general"
Output: {"action":"post_message","confidence":0.95,"channel":"general","message":"hello everyone"}

Input: "make a todo list in the x y z channel about reviewing the pr fixing the deploy and emailing the client"
Output: {"action":"create_todo_list","confidence":0.9,"channel":"xyz","items":["Review the PR","Fix the deploy","Email the client"]}

Input: "um create a to-do list in engineering about uh testing the webhook and also updating the docs okay moving on"
Output: {"action":"create_todo_list","confidence":0.85,"channel":"engineering","items":["Test the webhook","Update the docs"]}

Input: "file a github issue about the login button being broken on safari it throws a 500 when you click it"
Output: {"action":"create_github_issue","confidence":0.9,"title":"Login button broken on Safari","body":"Clicking the login button throws a 500 error on Safari."}

Input: "hey uh open an issue that we need dark mode on the dashboard"
Output: {"action":"create_github_issue","confidence":0.85,"title":"Add dark mode to the dashboard"}

Input: "comment on issue twelve saying we'll pick this up next sprint"
Output: {"action":"comment_github","confidence":0.9,"issueNumber":12,"body":"We'll pick this up next sprint."}

Input: "leave a comment on pull request 5 that the tests are passing now"
Output: {"action":"comment_github","confidence":0.9,"issueNumber":5,"body":"The tests are passing now."}

Input: "go ahead and close issue number 8"
Output: {"action":"close_github_issue","confidence":0.92,"issueNumber":8}

Input: "reopen issue 14 we're not done with it"
Output: {"action":"reopen_github_issue","confidence":0.9,"issueNumber":14}

Input: "add the bug and urgent labels to issue 9"
Output: {"action":"label_github_issue","confidence":0.9,"issueNumber":9,"labels":["bug","urgent"]}

Input: "assign sarah to issue 7"
Output: {"action":"assign_github_issue","confidence":0.9,"issueNumber":7,"assignees":["sarah"]}

Input: "merge pull request 21"
Output: {"action":"merge_pull_request","confidence":0.92,"issueNumber":21}

Input: "close pull request 3 we're abandoning that approach"
Output: {"action":"close_pull_request","confidence":0.9,"issueNumber":3}

Input: "request a review from alex on pr 15"
Output: {"action":"request_github_review","confidence":0.9,"issueNumber":15,"reviewers":["alex"]}

Input: "make a new branch and open a pull request titled mobile update changes"
Output: {"action":"create_pull_request","confidence":0.9,"title":"Mobile update changes"}

Input (transcript mentions: "Sarah: the export keeps timing out on large accounts, it 500s after 30 seconds") COMMAND: "hey taro make an issue about that"
Output: {"action":"create_github_issue","confidence":0.88,"title":"Export times out on large accounts","body":"The export request 500s after about 30 seconds for large accounts. Raised during the meeting."}

Input: "what's the weather like"
Output: {"action":"unknown","confidence":0.2,"reason":"That is not something I can do, I can post to Slack, manage GitHub issues and PRs, or make a todo list."}`;

const GROQ_LLM_URL = 'https://api.groq.com/openai/v1/chat/completions';
const GROQ_LLM_MODEL = process.env.GROQ_LLM_MODEL || 'openai/gpt-oss-120b';

interface RawParsed {
  action?: string;
  confidence?: number;
  channel?: string;
  message?: string;
  title?: string;
  items?: string[];
  body?: string;
  issueNumber?: number;
  labels?: string[];
  assignees?: string[];
  reviewers?: string[];
  branch?: string;
  reason?: string;
}

function buildIntent(parsed: RawParsed, command: string, source: 'groq' | 'gemini'): ParsedIntent {
  if (
    !parsed.action ||
    !Object.values(INTENTS).includes(parsed.action as (typeof INTENTS)[keyof typeof INTENTS]) ||
    typeof parsed.confidence !== 'number'
  ) {
    throw new Error(`Invalid response shape: ${JSON.stringify(parsed).slice(0, 200)}`);
  }
  const clip = (v: string | undefined, n: number) => (typeof v === 'string' ? v.slice(0, n) : v);
  return {
    action: parsed.action as ParsedIntent['action'],
    confidence: parsed.confidence,
    params: {
      channel: clip(parsed.channel, 80),
      message: clip(parsed.message, 2000),
      title: clip(parsed.title, 200),
      items: parsed.items,
      body: clip(parsed.body, 4000),
      issueNumber: parsed.issueNumber,
      labels: parsed.labels,
      assignees: parsed.assignees,
      reviewers: parsed.reviewers,
      branch: clip(parsed.branch, 60),
      reason: clip(parsed.reason, 300),
      ...(parsed.action === 'unknown' ? { original: command } : {}),
    },
    source,
  };
}

function buildUserPrompt(command: string, context?: string): string {
  const transcript = (context || '').slice(-3500).trim();
  return transcript
    ? `MEETING TRANSCRIPT (context, may contain unrelated chatter):\n${transcript}\n\nCOMMAND: "${command}"`
    : `COMMAND: "${command}"`;
}

// Primary path: Groq's Llama (generous free tier, shares the STT key).
async function parseWithGroq(command: string, context?: string): Promise<ParsedIntent> {
  const res = await fetch(GROQ_LLM_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${process.env.GROQ_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: GROQ_LLM_MODEL,
      temperature: 0.2,
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: `${SYSTEM_PROMPT}\n\nRespond with ONLY a single JSON object.` },
        { role: 'user', content: buildUserPrompt(command, context) },
      ],
    }),
  });
  if (!res.ok) throw new Error(`Groq LLM ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const data = (await res.json()) as { choices?: { message?: { content?: string } }[] };
  const raw = data.choices?.[0]?.message?.content;
  if (!raw) throw new Error('Empty Groq response');
  return buildIntent(JSON.parse(raw) as RawParsed, command, 'groq');
}

// Fallback path: Gemini structured output.
async function parseWithGemini(command: string, context?: string): Promise<ParsedIntent> {
  const ai = getClient();
  if (!ai) throw new Error('No Gemini client');
  const model = process.env.GEMINI_MODEL || DEFAULT_MODEL;
  const response = await ai.models.generateContent({
    model,
    contents: `${SYSTEM_PROMPT}\n\n${buildUserPrompt(command, context)}`,
    config: { responseMimeType: 'application/json', responseSchema: RESPONSE_SCHEMA, temperature: 0 },
  });
  const raw = response.text;
  if (!raw) throw new Error('Empty response from Gemini');
  return buildIntent(JSON.parse(raw) as RawParsed, command, 'gemini');
}

export async function parseIntent(command: string, context?: string): Promise<ParsedIntent> {
  // Groq first (generous free tier), Gemini next, regex last. One LLM call
  // now both classifies the intent AND writes the final content.
  if (process.env.GROQ_API_KEY) {
    try {
      return await parseWithGroq(command, context);
    } catch (error) {
      console.error('[Intent] Groq LLM failed, trying Gemini:', error instanceof Error ? error.message : error);
    }
  }
  if (process.env.GOOGLE_API_KEY) {
    try {
      return await parseWithGemini(command, context);
    } catch (error) {
      console.error('═'.repeat(60));
      console.error('[Intent] ❌ LLM parsing failed - falling back to regex (no body/PR support).');
      console.error('[Intent]', error instanceof Error ? error.message : error);
      console.error('═'.repeat(60));
    }
  } else {
    console.warn('[Intent] ⚠️  No LLM key configured - using regex fallback.');
  }
  return parseIntentSimple(command);
}