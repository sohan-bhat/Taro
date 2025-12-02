import type { ParsedIntent } from '@taro/shared';
import { INTENTS } from '@taro/shared';

// Simple regex-based intent parser for MVP (no API key required)
export function parseIntentSimple(command: string): ParsedIntent {
  const lower = command.toLowerCase().trim();

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
    };
  }

  // Pattern: "create task X in Y" or "add task X to Y"
  const taskMatch = lower.match(/(?:create|add)\s+(?:a\s+)?task\s+(.+?)\s+(?:to|in)\s+(?:the\s+)?#?(\w[\w-]*)/);
  if (taskMatch) {
    return {
      action: INTENTS.CREATE_TASK,
      confidence: 0.85,
      params: {
        task: taskMatch[1].trim(),
        channel: taskMatch[2].trim(),
      },
    };
  }

  // Unknown intent
  return {
    action: INTENTS.UNKNOWN,
    confidence: 0,
    params: { original: command },
  };
}

// Gemini-based parser (requires GOOGLE_API_KEY)
let genAI: any = null;
try {
  const { GoogleGenerativeAI } = require('@google/generative-ai');
  if (process.env.GOOGLE_API_KEY) {
    genAI = new GoogleGenerativeAI(process.env.GOOGLE_API_KEY);
  }
} catch {
  // Google AI SDK not available, will use simple parser
}

const SYSTEM_PROMPT = `You are Taro, a voice-activated meeting assistant. Your job is to parse voice commands and extract the intent and parameters.

You MUST respond with valid JSON in this exact format:
{
  "action": "post_message" | "create_task" | "unknown",
  "confidence": 0.0-1.0,
  "params": { ... }
}

For "post_message" action:
- Extract the channel name (remove # if present)
- Extract the message content
- params: { "channel": "channel-name", "message": "the message" }

For "create_task" action:
- Extract the channel name
- Extract the task description
- params: { "channel": "channel-name", "task": "task description" }

For "unknown" action:
- Use when the command is unclear or not supported
- params: { "original": "the original command" }

Examples:
Input: "post a message to general saying hello everyone"
Output: {"action":"post_message","confidence":0.95,"params":{"channel":"general","message":"hello everyone"}}

Input: "send hello world to the engineering channel"
Output: {"action":"post_message","confidence":0.9,"params":{"channel":"engineering","message":"hello world"}}

Input: "create a task in project-updates to review the PR"
Output: {"action":"create_task","confidence":0.85,"params":{"channel":"project-updates","task":"review the PR"}}

Input: "what's the weather"
Output: {"action":"unknown","confidence":0.1,"params":{"original":"what's the weather"}}

ONLY respond with JSON, no other text.`;

export async function parseIntent(command: string): Promise<ParsedIntent> {
  // If Gemini is not configured, use simple parser
  if (!genAI) {
    console.log('Using simple intent parser (no GOOGLE_API_KEY)');
    return parseIntentSimple(command);
  }

  try {
    const model = genAI.getGenerativeModel({ model: 'gemini-1.5-flash' });

    const result = await model.generateContent([
      { text: SYSTEM_PROMPT },
      { text: `Parse this command: "${command}"` },
    ]);

    const response = result.response.text();

    // Extract JSON from response (handle potential markdown code blocks)
    let jsonStr = response.trim();
    if (jsonStr.startsWith('```')) {
      jsonStr = jsonStr.replace(/```json?\n?/g, '').replace(/```/g, '').trim();
    }

    const parsed = JSON.parse(jsonStr) as ParsedIntent;

    // Validate the response
    if (!parsed.action || typeof parsed.confidence !== 'number' || !parsed.params) {
      throw new Error('Invalid response format');
    }

    return parsed;
  } catch (error) {
    console.error('Gemini parsing error, falling back to simple parser:', error);

    // Fallback to simple parser on error
    return parseIntentSimple(command);
  }
}

// Extract the command part after "Hey Taro"
export function extractCommand(transcript: string): string | null {
  const lowerTranscript = transcript.toLowerCase();
  const wakeWordIndex = lowerTranscript.indexOf('hey taro');

  if (wakeWordIndex === -1) {
    return null;
  }

  // Get everything after "hey taro"
  const afterWakeWord = transcript.substring(wakeWordIndex + 8).trim();

  // Remove common filler words at the start
  const cleaned = afterWakeWord
    .replace(/^[,.]?\s*/g, '') // Remove leading punctuation/spaces
    .replace(/^(please|can you|could you|would you)\s+/i, '') // Remove polite prefixes
    .trim();

  return cleaned || null;
}
