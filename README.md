# Taro

**Say it in the meeting. Done before you hang up.**

Taro sits in your Google Meet, Zoom, and Microsoft Teams calls and listens for "Hey Taro." Ask it to post in Slack, file a GitHub issue, or open a pull request, and it happens while everyone keeps talking, confirmed with a ding in the call.

Taro is the port between your meetings and your tools. Every workspace plugs in its own accounts:

| Slot | Provider | Used for |
|---|---|---|
| Meeting bot | [MeetingBaas](https://meetingbaas.com) | Joins the call and streams its audio to Taro |
| AI model | Anthropic, OpenAI, Google, Groq, OpenRouter, or any OpenAI-compatible API | Works out what people asked for and writes the result |
| Transcription | Groq Whisper or OpenAI (or a server the operator hosts) | Turns speech into text as people talk |
| Tools | Slack, GitHub | Where the work lands |

Keys are checked with the provider, encrypted at rest, and never shown again. Taro never resells usage; each workspace pays its own providers.

## How a meeting goes

```
A meeting on someone's connected Google Calendar,
or a link posted in Slack (or pasted in the dashboard)
        │
        ▼
Taro sends a bot with the workspace's MeetingBaas key
        │  live audio over a per-meeting secret WebSocket
        ▼
Transcription (workspace key) ──▶ "Hey Taro, file an issue about that"
        │
        ▼
AI model (workspace key) reads the request and the conversation,
returns a structured action with the content written out
        │
        ▼
Slack message, todo list, GitHub issue, comment, or pull request
        │
        ▼
Ding in the call, reply in the Slack thread, recap when the call ends
```

## What you can say

| Request | Example |
|---|---|
| Post a message | "Hey Taro, tell engineering the deploy is done" |
| Todo list | "Hey Taro, make a todo list in projects for the launch, the docs, and QA" |
| GitHub issue | "Hey Taro, file an issue about the export timing out" |
| Pull request | "Hey Taro, open a pull request to fix the reports page" |
| Comment, label, assign, review, close, merge | "Hey Taro, comment on issue 12 that we'll pick it up next sprint" |

Taro reads the conversation, so "file an issue about that" becomes a written issue about what was discussed. Each workspace decides which GitHub actions are allowed; merging is off by default.

To send meetings, requests, and transcripts to your own tools, add a webhook in Setup. See [docs/WEBHOOKS.md](docs/WEBHOOKS.md) for the events and how to check the signature.

## Project structure

```
apps/web          Next.js: landing page, sign-in (Google, Slack), dashboard, demo
apps/extension    Chrome and Edge extension: an Invite Taro button inside Google Meet
packages/api      Express API: auth, provider keys, Slack listener, realtime audio, actions
packages/shared   Types, constants, and the provider catalog both sides use
docs/             Slack app manifest, the deployment guide, and the webhooks reference
```

## Local development

Requirements: Node 22 or newer, pnpm 9, a MongoDB database, a Slack app, and a public https URL for the API (Slack and MeetingBaas call it). A static [ngrok](https://ngrok.com) domain works well for that.

```bash
pnpm install
cp .env.example .env          # fill in MONGODB_URI, ENCRYPTION_KEY, API_URL, Slack values
```

1. Start a tunnel to the API: `ngrok http 4000 --domain=<your-domain>`, and set `API_URL` to that https URL.
2. Create the Slack app from `docs/slack-app-manifest.yaml` with that domain (see `docs/DEPLOY.md`, section 3).
3. Run both apps:

```bash
pnpm --filter @taro/api dev   # http://localhost:4000
pnpm --filter @taro/web dev   # http://localhost:3000
```

4. Open http://localhost:3000, sign in, and follow **Setup** in the dashboard. Slack sign-in works with just the Slack app; Google sign-in needs its own client ID (`docs/DEPLOY.md`, section 3).

The dashboard talks to `http://localhost:4000` by default; set `NEXT_PUBLIC_API_URL` in `apps/web/.env.local` to change it.

### Tests

```bash
pnpm --filter @taro/api test        # wake word, intent fallback, VAD, encryption, URL and origin checks
pnpm --filter @taro/api typecheck
pnpm --filter @taro/web exec tsc --noEmit
```

### Local transcription (optional)

Workspaces normally use Groq or OpenAI for transcription. For fully offline development the API can run the sherpa-onnx model in process (`LOCAL_ASR=1`, model files in `packages/api/models`) or talk to the faster-whisper server in `packages/api/stt-server` (`STT_WS_URL`).

## Deploying

See **[docs/DEPLOY.md](docs/DEPLOY.md)** for the full guide: MongoDB, Slack and Google sign-in, Connect Google Calendar, the GitHub app, the API on Render, Railway, Fly.io, or Docker, and the dashboard on Vercel.

## Troubleshooting

**Taro doesn't join when a link is posted.** It only sees public channels it's a member of; Taro joins every public channel when it's added to Slack, and `/invite @taro` covers channels created later. Check the API log for `Listening for meeting links via Socket Mode`, and that the workspace's setup is complete (Taro replies in the thread with what's missing).

**Taro joined but nothing happens when I talk.** Admit it from the lobby. In the dashboard, open the meeting: **Hearing now** shows what transcription is producing. If it stays empty, check the transcription key.

**A command came back with "Needs you".** The meeting's command list shows Taro's reason, including provider errors such as a rejected key or an exhausted quota.

**GitHub actions fail.** Pick a default repository on the GitHub card, and check **Permissions**: anything turned off is refused on purpose.

## License

MIT
