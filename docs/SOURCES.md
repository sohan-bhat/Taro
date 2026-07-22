# External Sources & References

Log of external APIs, SDKs, and documentation this project is built against.

## APIs & Services

| Service | What Taro uses it for | Docs |
|---------|----------------------|------|
| MeetingBaas | Meeting bot infrastructure — deploys a bot into Google Meet, delivers status + transcript webhooks | https://docs.meetingbaas.com / https://www.meetingbaas.com/en/api/bots-api |
| Google Gemini API | Intent parsing of voice commands (via `@google/genai` SDK) | https://ai.google.dev/gemini-api/docs |
| Slack Web API | Posting messages/tasks to channels (`chat.postMessage`, `conversations.list`, `conversations.join`) | https://api.slack.com/web |
| Slack OAuth v2 | Workspace installation flow | https://api.slack.com/authentication/oauth-v2 |
| Slack Socket Mode | Receiving `message.channels` events without a public URL | https://api.slack.com/apis/socket-mode |
| MongoDB Atlas | Database (companies, meetings, connections, action logs) | https://www.mongodb.com/docs/atlas/ |

## Key SDK / API version notes

- **Gemini**: migrated from the deprecated `@google/generative-ai` SDK (EOL 2025-11-30)
  to the unified `@google/genai` SDK. The old `gemini-1.5-flash` model was retired
  2025-09-24; the model is now configurable via `GEMINI_MODEL`.
  Migration guide: https://ai.google.dev/gemini-api/docs/migrate
  Deprecations: https://ai.google.dev/gemini-api/docs/deprecations
- **MeetingBaas**: auth header updated from legacy `x-spoke-api-key` to
  `x-meeting-baas-api-key`. Webhook events handled: `bot.status_change`,
  `complete`, `failed`. Live per-utterance transcripts require MeetingBaas
  WebSocket streaming (not implemented — commands execute post-meeting).
  Webhooks: https://www.meetingbaas.com/en/api/webhooks-api
- **Slack**: receiving `message.channels` events requires the `channels:history`
  bot scope and the bot must be a member of the channel.
  https://api.slack.com/events/message.channels

## Frameworks & libraries

Next.js 14, Express 4, Mongoose 8, Tailwind CSS 3, Turborepo 2, pnpm workspaces,
`@slack/web-api`, `@slack/socket-mode`, `@google/genai`, dotenv, tsx.
