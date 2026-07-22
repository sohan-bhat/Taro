# Taro - Voice-Activated Meeting Assistant

Taro is a voice-activated meeting assistant that joins Google Meet calls, listens for commands ("Hey Taro..."), and executes actions via Slack.

## Features

- **Voice Commands**: Say "Hey Taro, post hello to #general" during a meeting
- **Slack Integration**: Posts messages, creates tasks in connected Slack workspaces
- **Auto-Join**: Automatically detects meeting links in Slack and joins them
- **Manual Join**: Paste a Meet link on the dashboard and Taro joins immediately
- **Action Log**: Dashboard shows every command Taro heard and what happened

## How commands execute

Taro's bot records the meeting via MeetingBaas. When the meeting **ends**,
MeetingBaas delivers the full transcript to Taro's webhook, Taro scans it for
"Hey Taro" commands, parses each one with Gemini (regex fallback if no API
key), and executes them in Slack. Real-time in-meeting execution would require
MeetingBaas WebSocket streaming and is not implemented.

## Project Structure

```
taro/
├── apps/
│   └── web/          # Next.js dashboard
├── packages/
│   ├── api/          # Express API server
│   └── shared/       # Shared types & constants
```

## Quick Start

### Prerequisites

- Node.js 18+
- pnpm 9+
- MongoDB Atlas account (free tier)
- Google AI Studio API key (for Gemini intent parsing — optional)
- Slack workspace (to create an app)
- MeetingBaas API key

### 1. Install Dependencies

```bash
pnpm install
```

### 2. Set Up Environment Variables

```bash
cp .env.example .env
```

Then fill in your credentials (see comments in `.env.example`).

### 3. Set Up External Services

#### MongoDB Atlas
1. Go to [mongodb.com/atlas](https://www.mongodb.com/atlas)
2. Create a free cluster
3. Create database user and get connection string

#### Slack App
1. Go to [api.slack.com/apps](https://api.slack.com/apps)
2. Create New App → From scratch
3. Add Bot Token OAuth Scopes: `chat:write`, `channels:read`, `channels:join`, `channels:history`, `users:read`
   (`channels:history` is required to receive channel messages for auto-join)
4. Enable Socket Mode and create App-Level Token with `connections:write` scope
5. Enable Event Subscriptions and subscribe to the `message.channels` bot event
6. Install to workspace
7. Copy Client ID, Client Secret, Signing Secret, and App Token
8. **Invite the bot to any channel where meeting links get posted** — Slack only
   delivers messages from channels the bot is a member of

#### Google Gemini (optional)
1. Create an API key at [aistudio.google.com](https://aistudio.google.com)
2. Without a key, Taro uses a built-in regex parser (works for simple phrasings)

#### MeetingBaas
1. Sign up at [meetingbaas.com](https://meetingbaas.com)
2. Get your API key

### 4. Run Development Servers

```bash
# Terminal 1: API Server (handles webhooks from MeetingBaas)
pnpm --filter @taro/api dev

# Terminal 2: Web Dashboard
pnpm --filter @taro/web dev
```

For local development with webhooks, use ngrok:
```bash
ngrok http 4000
# Set API_URL in .env to the ngrok URL, then restart the API server
```

### 5. Test the Flow

1. Open http://localhost:3000
2. Register a company
3. Connect Slack (or skip and use manual join)
4. Post a Google Meet URL in a Slack channel the bot is in — or paste it into
   "Join a Meeting" on the dashboard
5. Taro bot joins the meeting
6. In the meeting, say **"Hey Taro, post hello to general"**
7. End the meeting — the command executes and appears under "Recent Actions"

## Voice Commands

| Command | Example |
|---------|---------|
| Post message | "Hey Taro, post hello world to general" |
| Create task | "Hey Taro, create a task in project to review the PR" |

Tips for reliable recognition:
- Pause briefly after "Hey Taro"
- Say the channel name without "#" ("to general", not "to hashtag general")

## Architecture

```
Slack Message ──► SlackListener (Socket Mode)     Dashboard "Join a Meeting"
                       │                                   │
                       └──────────► POST /bots ◄───────────┘
                                 (MeetingBaas — bot joins call)
                                        │
                          webhooks: status / failed / complete
                                        ▼
                              API Server (Express)
                                        │
                         complete → scan transcript for "Hey Taro"
                                        │
                            Intent Parser (Gemini / regex)
                                        │
                              Slack chat.postMessage
                                        │
                              ActionLog → Dashboard
```

## Deployment

- **API + Web**: Railway, Render, or Vercel
- **Database**: MongoDB Atlas (free tier)

The API server must be publicly accessible to receive MeetingBaas webhooks
(set `API_URL` to the public URL).

## Troubleshooting

### Bot doesn't join meeting
- Check MeetingBaas API key is valid
- Ensure `API_URL` is publicly accessible (webhooks must reach it)
- Check API server logs — every webhook payload is logged

### Auto-join doesn't trigger from Slack
- Confirm the bot has the `channels:history` scope and Socket Mode is on
- Confirm the bot is **a member of** the channel (invite it with `/invite @Taro`)
- Watch API logs for "Detected Meet link"

### Commands not executing
- Commands are processed **when the meeting ends** — end the call first
- Check the logged "Full transcript" in API logs: did "hey taro" survive
  transcription? (Common mishearings like "hey tara" are handled)
- Check the "Recent Actions" card on the dashboard for failure reasons

### Slack posting fails
- Verify OAuth tokens are valid (reconnect Slack from the dashboard)
- Check channel name spelling
- Ensure the bot can join the channel (public channels only, unless invited)

## Known limitations / future work

- Commands execute post-meeting (real-time requires MeetingBaas streaming)
- The MeetingBaas webhook endpoint is unauthenticated — add a shared-secret
  check before any serious deployment
- Transcript buffer is in-memory (single instance only)

## Sources

External APIs and documentation referenced: see [docs/SOURCES.md](docs/SOURCES.md).

## License

MIT
