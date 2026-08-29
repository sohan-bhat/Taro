/**
 * Turns a raw spoken command plus meeting context into polished,
 * connector-appropriate content. One registry entry per action, so a new
 * connector just adds a spec here. Falls back to the raw extracted params
 * if Gemini is unavailable.
 */

import { GoogleGenAI, Type } from '@google/genai';
import { INTENTS } from '@taro/shared';
import type { IntentParams } from '@taro/shared';

const DEFAULT_MODEL = 'gemini-3.6-flash';

let client: GoogleGenAI | null = null;
function getClient(): GoogleGenAI | null {
  if (!process.env.GOOGLE_API_KEY) return null;
  if (!client) {
    client = new GoogleGenAI({ apiKey: process.env.GOOGLE_API_KEY });
  }
  return client;
}

interface ContentSpec {
  /** What good output looks like for this connector */
  instructions: string;
  schema: object;
}

const SPECS: Partial<Record<string, ContentSpec>> = {
  [INTENTS.CREATE_GITHUB_ISSUE]: {
    instructions: `Write a real GitHub issue the way a good engineer would.
- "title": short, imperative, specific (like a commit subject).
- "body": GitHub-flavored markdown. Start with a "## Summary" section (2-3 sentences describing the problem or request as discussed in the meeting). Add "## Details" with any concrete specifics mentioned (browsers, error codes, pages, people affected). If the meeting mentioned next steps or acceptance criteria, add "## Next steps" as a checklist. Never paste raw transcript text; write it properly. Never invent specifics that were not said.`,
    schema: {
      type: Type.OBJECT,
      properties: {
        title: { type: Type.STRING },
        body: { type: Type.STRING },
      },
      required: ['title', 'body'],
    },
  },
  [INTENTS.POST_MESSAGE]: {
    instructions: `Produce "message": the text to post to a workplace Slack channel. Decide which of two cases this is:
1. RELAY - the speaker dictated a specific message to pass along ("post hello team", "tell everyone the build is green", "say the deploy is done"). Then "message" is that dictated text, cleaned up: fix casing, grammar and transcription glitches, keep their meaning and tone, add nothing new.
2. COMPOSE - the speaker asked Taro to WRITE/DRAFT/GENERATE something ("write a statement about X", "write your opinion on Y", "draft a note about the launch", "announce the outage", "summarize what we decided"). Then Taro actually writes it: produce well-written, appropriate Slack prose that fulfills the request, using the meeting context for substance. Do NOT echo the instruction back; genuinely author the content. Keep it concise and professional.
Use the meeting transcript context for anything the speaker referenced ("about what we discussed", "today's decision").`,
    schema: {
      type: Type.OBJECT,
      properties: {
        message: { type: Type.STRING },
      },
      required: ['message'],
    },
  },
  [INTENTS.COMMENT_GITHUB]: {
    instructions: `Produce "body": the comment to post on the GitHub issue/PR, written cleanly and professionally as an engineer would, based on what the speaker dictated and the meeting context. Fix grammar and transcription glitches; do not invent facts. Keep "issueNumber" unchanged.`,
    schema: {
      type: Type.OBJECT,
      properties: { body: { type: Type.STRING } },
      required: ['body'],
    },
  },
  [INTENTS.CREATE_PULL_REQUEST]: {
    instructions: `Write a real pull request. "title": short imperative summary (like a commit subject). "body": GitHub-flavored markdown describing what the PR proposes and why, grounded in the meeting discussion, with a "## Summary" section and, if next steps were mentioned, a "## Changes" checklist. Never paste raw transcript; write it properly. Never invent specifics not said.`,
    schema: {
      type: Type.OBJECT,
      properties: { title: { type: Type.STRING }, body: { type: Type.STRING } },
      required: ['title', 'body'],
    },
  },
  [INTENTS.CREATE_TODO_LIST]: {
    instructions: `Produce "title" (short, specific to what was discussed) and "items": each a clean imperative task ("Fix the deploy pipeline"), deduplicated, expanded with concrete detail from the meeting context when it was actually said. Never invent tasks that were not mentioned.`,
    schema: {
      type: Type.OBJECT,
      properties: {
        title: { type: Type.STRING },
        items: { type: Type.ARRAY, items: { type: Type.STRING } },
      },
      required: ['items'],
    },
  },
};

/** Merges composed fields into the original params; falls back to the originals on any failure so execution never blocks on composition. */
export async function composeContent(
  action: string,
  params: IntentParams,
  command: string,
  meetingContext?: string
): Promise<IntentParams> {
  const spec = SPECS[action];
  const ai = getClient();
  if (!spec || !ai) return params;

  const model = process.env.GEMINI_MODEL || DEFAULT_MODEL;
  const context = (meetingContext || '').slice(-3000).trim();

  const prompt = `You are Taro, a meeting assistant. During a live meeting someone gave this voice command (raw speech-to-text, may contain misheard words): "${command}"

Draft parameters extracted from the command: ${JSON.stringify(params)}

Recent meeting transcript for context (raw speech-to-text, contains unrelated chatter; use it only to understand what was being discussed):
"""${context || '(no transcript context available)'}"""

${spec.instructions}

Ground everything in the command and the transcript. If the context does not add anything, work from the command alone.`;

  try {
    const response = await ai.models.generateContent({
      model,
      contents: prompt,
      config: {
        responseMimeType: 'application/json',
        responseSchema: spec.schema,
        temperature: 0.3,
      },
    });
    const raw = response.text;
    if (!raw) throw new Error('Empty response');
    const composed = JSON.parse(raw) as Partial<IntentParams>;

    // Composed fields win, but only when they carry content
    const merged: IntentParams = { ...params };
    for (const [key, value] of Object.entries(composed)) {
      const hasContent =
        (typeof value === 'string' && value.trim().length > 0) ||
        (Array.isArray(value) && value.length > 0);
      if (hasContent) {
        (merged as Record<string, unknown>)[key] = value;
      }
    }
    return merged;
  } catch (error) {
    console.error(
      `[Composer] ⚠️ Content composition failed for ${action}, using raw extraction:`,
      error instanceof Error ? error.message : error
    );
    return params;
  }
}
