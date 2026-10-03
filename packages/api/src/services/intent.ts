import type { LlmProviderId, ParsedIntent } from '@taro/shared';
import { COPY, INTENTS, cleanDashes } from '@taro/shared';
import { completeJson, LlmError, type LlmConfig } from './llm';
import { log } from '../lib/logger';

// Regex fallback for when no LLM is reachable. Handles the common commands only.
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

export const SYSTEM_PROMPT = `You are Taro, a voice-activated meeting assistant. You receive raw speech-to-text of a spoken command and extract the intent.

You are given the recent MEETING TRANSCRIPT plus the specific COMMAND the user spoke after saying "Hey Taro". Reason over the whole conversation like a smart teammate would, not just the command words in isolation.

The text comes from meeting audio transcription, so expect: missing punctuation, filler words ("um", "like"), misheard words, and trailing unrelated conversation.

Use the transcript to resolve references. If the command says "that", "it", "the issue we discussed", "what I mentioned earlier", "the bug from before", or is otherwise underspecified, look back through the transcript and fill in the specifics yourself (the real bug, the real topic, the actual issue/PR number if it was said). Compose real content grounded in what was actually discussed; never echo the raw transcript and never invent facts that were not said.

Common misrecognitions to interpret correctly: "todo list" often appears as "total list", "to do list", or "to-do list"; "github" often appears as "git hub", "get hub", or "good hub"; channel names may be spelled out ("x y z" = "xyz") or split ("general chat" = "general-chat" if that reads as one channel name).

Actions:
- "post_message": user wants a message posted to a Slack channel. Extract "channel" and "message".
- "create_todo_list": user wants a todo list created in a Slack channel. Extract "channel", optional "title", and "items" (each distinct task as one item).
- "create_github_issue": user wants a GitHub issue filed (words like "issue", "bug", "ticket"). Extract "title" (short imperative summary) and ALWAYS write a full "body" (a proper markdown write-up, see WRITING CONTENT). Never leave the body empty and never make it a bare phrase.
- "comment_github": user wants to comment on an existing issue or pull request. Extract "issueNumber" (the number they reference, e.g. "issue 12", "PR number 5", "pull request 8") and "body" (the comment text).
- "close_github_issue": user wants to close an issue. Extract "issueNumber".
- "reopen_github_issue": user wants to reopen a closed issue. Extract "issueNumber".
- "label_github_issue": user wants to add labels to an issue. Extract "issueNumber" and "labels" (array).
- "assign_github_issue": user wants to assign teammates to an issue. Extract "issueNumber" and "assignees" (array of GitHub usernames as spoken).
- "close_pull_request": user wants to close a pull request. Extract "issueNumber" (the PR number).
- "merge_pull_request": user wants to merge a pull request. Extract "issueNumber" (the PR number).
- "request_github_review": user wants to request reviewers on a PR. Extract "issueNumber" (PR number) and "reviewers" (array of usernames).
- "create_pull_request": user wants to open a NEW pull request (often phrased as "make a branch and a pull request", "open a PR for...", "make a PR to main"). This is a valid, supported action, never say you cannot do it. Extract "title" (short imperative summary), ALWAYS write a full "body" (markdown with ## Summary and a ## Changes checklist, see WRITING CONTENT), and optional "branch" (only if they named one). Taro creates the branch, makes the commits, and opens the PR itself.
There is one configured repo, so never extract a repo or channel for GitHub actions.
- "unknown": use ONLY when you genuinely cannot map the request to an action above. Whenever you return "unknown" you MUST set "reason" to a helpful, specific sentence: say what you understood the user wanted, and either what is missing (e.g. "which channel should I post to?") or why you cannot do it and the closest thing you can. Never return a bare unknown with no reason. Prefer to actually pick an action and fill in details from the transcript rather than giving up.

WRITING CONTENT (produce final, publishable content, never placeholders or raw transcript):
- create_github_issue / create_pull_request: "title" is a short imperative summary. "body" is REQUIRED and must be real GitHub-flavored markdown, never a single short phrase, never a copy of the title, never empty. Always include a "## Summary" of two to three full sentences describing the problem or request grounded in the discussion. When specifics were mentioned (browsers, error codes, pages, affected customers), add a "## Details" section as a bullet list. For a pull request, add a "## Changes" section as a markdown checklist ("- [ ] ...") of the work being proposed. If little detail was given, still write a proper Summary but do not invent facts, just omit the Details section. A body like "customer dissatisfaction" is WRONG; write it up like a real engineer filing the ticket.
- comment_github: "body" is a clean, professional comment.
- post_message: if the user dictated a message, clean it up; if they asked you to WRITE something (an opinion, statement, announcement, summary), actually author it well for a workplace Slack channel.
- create_todo_list: "items" are clean, deduplicated imperative tasks.
- Everywhere: Write every field (message, title, body, items, comment, reason) as plain sentences. Never use em dashes or en dashes; use a comma, a period, or the word 'to'. Never name who said something. Markdown headings, lists, and checklists in a body are fine; the sentences inside them follow the same rule.

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
Output: {"action":"create_github_issue","confidence":0.9,"title":"Login button returns a 500 on Safari","body":"## Summary\nThe login button is broken on Safari. Clicking it returns an HTTP 500 instead of signing the user in, which blocks Safari users from logging in entirely.\n\n## Details\n- Browser: Safari\n- Action: clicking the login button\n- Result: HTTP 500 error"}

Input: "hey uh open an issue that we need dark mode on the dashboard"
Output: {"action":"create_github_issue","confidence":0.85,"title":"Add dark mode to the dashboard","body":"## Summary\nThe dashboard needs a dark mode so it is comfortable to use in low light and matches the rest of the product."}

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
Output: {"action":"create_pull_request","confidence":0.9,"title":"Mobile update changes","body":"## Summary\nOpen a pull request to track the mobile updates discussed in the meeting so the changes can be reviewed before they land.\n\n## Changes\n- [ ] Apply the mobile layout updates\n- [ ] Verify the screens on small viewports"}

Input (transcript mentions: "the reports page is still slow, I'd profile it before we touch the queries") COMMAND: "hey taro open a pull request to speed up the reports page"
Output: {"action":"create_pull_request","confidence":0.88,"title":"Speed up the reports page","body":"## Summary\nThe reports page loads too slowly. This tracks the work to profile it and speed it up before anyone changes the queries.\n\n## Changes\n- [ ] Profile the reports page load\n- [ ] Fix the slowest queries or renders\n- [ ] Confirm the page loads faster"}

Input (transcript mentions: "the export keeps timing out for our biggest customers. same on northwind, it fails after about thirty seconds") COMMAND: "hey taro file an issue about that"
Output: {"action":"create_github_issue","confidence":0.88,"title":"Export times out on large accounts","body":"## Summary\nThe export times out for our largest customers. It fails after roughly 30 seconds, so those customers can't export their data.\n\n## Details\n- Affected: large accounts, including Northwind\n- Symptom: the export fails after about 30 seconds"}

Input: "what's the weather like"
Output: {"action":"unknown","confidence":0.2,"reason":"I can't check the weather. I can post in Slack, make a checklist, or work on GitHub issues and pull requests."}`;

// One schema for every provider with structured output (Claude, Gemini). The
// OpenAI-compatible providers run in JSON mode, so buildIntent re-validates.
const INTENT_SCHEMA: Record<string, unknown> = {
  type: 'object',
  additionalProperties: false,
  required: ['action', 'confidence'],
  properties: {
    action: { type: 'string', enum: Object.values(INTENTS) },
    confidence: { type: 'number' },
    channel: { type: 'string' },
    message: { type: 'string' },
    title: { type: 'string' },
    items: { type: 'array', items: { type: 'string' } },
    body: { type: 'string' },
    issueNumber: { type: 'integer' },
    labels: { type: 'array', items: { type: 'string' } },
    assignees: { type: 'array', items: { type: 'string' } },
    reviewers: { type: 'array', items: { type: 'string' } },
    branch: { type: 'string' },
    reason: { type: 'string' },
  },
};

interface RawParsed {
  action?: unknown;
  confidence?: unknown;
  channel?: unknown;
  message?: unknown;
  title?: unknown;
  items?: unknown;
  body?: unknown;
  issueNumber?: unknown;
  labels?: unknown;
  assignees?: unknown;
  reviewers?: unknown;
  branch?: unknown;
  reason?: unknown;
}

const VALID_ACTIONS = new Set<string>(Object.values(INTENTS));

function str(v: unknown, max: number): string | undefined {
  return typeof v === 'string' && v.trim() ? v.trim().slice(0, max) : undefined;
}

function strList(v: unknown, maxItems: number, maxLen: number): string[] | undefined {
  if (!Array.isArray(v)) return undefined;
  const items = v
    .filter((x): x is string => typeof x === 'string' && x.trim().length > 0)
    .map((x) => x.trim().slice(0, maxLen))
    .slice(0, maxItems);
  return items.length > 0 ? items : undefined;
}

// Written fields are cleaned of dashes even though the prompt asks; models reach for them anyway.
function prose(v: unknown, max: number): string | undefined {
  const s = str(v, max);
  return s ? cleanDashes(s) || undefined : undefined;
}

function proseList(v: unknown, maxItems: number, maxLen: number): string[] | undefined {
  const items = strList(v, maxItems, maxLen)?.map(cleanDashes).filter(Boolean);
  return items && items.length > 0 ? items : undefined;
}

// Model output is untrusted input: check the shape and clamp every field before it reaches a connector.
export function buildIntent(raw: unknown, command: string, source: LlmProviderId): ParsedIntent {
  const parsed = (raw && typeof raw === 'object' ? raw : {}) as RawParsed;
  if (typeof parsed.action !== 'string' || !VALID_ACTIONS.has(parsed.action)) {
    throw new LlmError(`The model returned an unexpected action: ${JSON.stringify(raw).slice(0, 160)}`, 'bad_response');
  }
  const confidence = typeof parsed.confidence === 'number' ? Math.max(0, Math.min(1, parsed.confidence)) : 0.5;
  const issueNumber =
    typeof parsed.issueNumber === 'number' && Number.isFinite(parsed.issueNumber) && parsed.issueNumber > 0
      ? Math.round(parsed.issueNumber)
      : undefined;

  return {
    action: parsed.action as ParsedIntent['action'],
    confidence,
    params: {
      channel: str(parsed.channel, 80),
      message: prose(parsed.message, 2000),
      title: prose(parsed.title, 200),
      items: proseList(parsed.items, 25, 200),
      body: prose(parsed.body, 4000),
      issueNumber,
      labels: strList(parsed.labels, 10, 50),
      assignees: strList(parsed.assignees, 10, 40),
      reviewers: strList(parsed.reviewers, 10, 40),
      branch: str(parsed.branch, 60),
      reason: prose(parsed.reason, 300),
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

// Provider hiccups (overloaded, rate limited, a dropped connection) usually clear in a second.
function isTransient(error: unknown): boolean {
  if (!(error instanceof LlmError)) return false;
  return error.kind === 'rate_limit' || error.kind === 'network' || (error.status !== undefined && error.status >= 500);
}

async function completeWithRetry(llm: LlmConfig, req: Parameters<typeof completeJson>[1]): Promise<unknown> {
  try {
    return await completeJson(llm, req);
  } catch (error) {
    if (!isTransient(error)) throw error;
    await new Promise((resolve) => setTimeout(resolve, 1200));
    return completeJson(llm, req);
  }
}

// "Make an issue about that": the regex can't know what "that" is, only the model can.
const REFERENCE_ONLY = /^(that|this|it|those|these|them|the (bug|issue|thing|one|problem|idea)( we (discussed|talked about|mentioned))?)$/i;

function contextOnlyReference(intent: ParsedIntent): string | null {
  const p = intent.params;
  const key = p.title ?? p.message ?? (p.items && p.items.length === 1 ? p.items[0] : undefined);
  if (!key) return null;
  const bare = key.trim().replace(/[.!?]+$/, '');
  return REFERENCE_ONLY.test(bare) ? bare.toLowerCase() : null;
}

/**
 * Classifies a spoken command and writes its content in one call to the
 * workspace's own model. If the model is unreachable, the regex fallback
 * still handles simple self-contained commands ("post the build is green to
 * engineering"); anything it would have to guess at, like "that", is refused
 * with the provider's error so the person knows why and can say it again.
 */
export async function parseIntent(command: string, context: string | undefined, llm: LlmConfig | null): Promise<ParsedIntent> {
  let reason: string = COPY.noModel;
  if (llm) {
    try {
      const raw = await completeWithRetry(llm, {
        system: SYSTEM_PROMPT,
        user: buildUserPrompt(command, context),
        schema: INTENT_SCHEMA,
      });
      return buildIntent(raw, command, llm.provider);
    } catch (error) {
      const detail = error instanceof LlmError ? error.message : `The AI request failed: ${error instanceof Error ? error.message : String(error)}`;
      log.warn(`[Intent] ${llm.provider}/${llm.model} failed, trying the simple parser: ${detail}`);
      reason = COPY.modelUnreachable(detail);
    }
  }

  const fallback = parseIntentSimple(command);
  const reference = fallback.action === 'unknown' ? null : contextOnlyReference(fallback);
  if (fallback.action === 'unknown' || reference) {
    return {
      action: 'unknown',
      confidence: 0,
      params: {
        original: command,
        reason: reference ? `${reason} Working out what “${reference}” means needs the AI model.` : reason,
      },
      source: 'fallback_regex',
    };
  }
  return fallback;
}
