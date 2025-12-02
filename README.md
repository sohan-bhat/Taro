# Taro - Voice-Activated Meeting Assistant

Taro is a voice-activated meeting assistant that joins Google Meet calls, listens for commands ("Hey Taro..."), and executes actions via Slack.

## Features

- **Voice Commands**: Say "Hey Taro, post hello to #general" during a meeting
- **Slack Integration**: Posts messages, creates tasks in connected Slack workspaces
- **Auto-Join**: Automatically detects meeting links in Slack and joins them
- **Meeting Transcription**: Uses MeetingBaas API for meeting bot infrastructure

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
- Google Cloud account (for Gemini API)
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

Edit `.env` with your credentials:

```env
# MongoDB (create free cluster at mongodb.com/atlas)
MONGODB_URI=mongodb+srv://user:pass@cluster.mongodb.net/taro

# Slack App (create at api.slack.com/apps)
SLACK_CLIENT_ID=your-client-id
SLACK_CLIENT_SECRET=your-client-secret
SLACK_SIGNING_SECRET=your-signing-secret
SLACK_APP_TOKEN=xapp-... # App-level token for Socket Mode

# Google (for Gemini intent parsing)
GOOGLE_API_KEY=your-gemini-api-key

# MeetingBaas API
MEETINGBAAS_API_KEY=your-meetingbaas-api-key

# URLs
NEXT_PUBLIC_APP_URL=http://localhost:3000
NEXT_PUBLIC_API_URL=http://localhost:4000
API_URL=http://localhost:4000
```

### 3. Set Up External Services

#### MongoDB Atlas
1. Go to [mongodb.com/atlas](https://www.mongodb.com/atlas)
2. Create a free cluster
3. Create database user and get connection string

#### Slack App
1. Go to [api.slack.com/apps](https://api.slack.com/apps)
2. Create New App → From scratch
3. Add OAuth Scopes: `chat:write`, `channels:read`, `channels:join`, `users:read`
4. Enable Socket Mode and create App-Level Token with `connections:write` scope
5. Enable Event Subscriptions and subscribe to `message.channels` event
6. Install to workspace
7. Copy Client ID, Client Secret, Signing Secret, and App Token

#### Google Cloud
1. Enable Gemini API at [ai.google.dev](https://ai.google.dev)
2. Create API key

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
# Update API_URL and NEXT_PUBLIC_API_URL in .env with ngrok URL
```

### 5. Test the Flow

1. Open http://localhost:3000
2. Register a company
3. Connect Slack
4. Post a Google Meet URL in any Slack channel
5. Taro bot will automatically join the meeting
6. In the meeting, say "Hey Taro, post hello to #general"
7. After the meeting ends, the command will be executed

## Voice Commands

| Command | Example |
|---------|---------|
| Post message | "Hey Taro, post hello world to #general" |
| Create task | "Hey Taro, create a task in #project to review the PR" |

## Architecture

```
Slack Message → SlackListener (Socket Mode)
                    ↓
              Detect Meet Link
                    ↓
         MeetingBaas API (bot joins)
                    ↓
         Webhooks → API Server
                    ↓
         Intent Parser (Gemini Flash)
                    ↓
            Slack (execute action)
```

## Deployment

### Recommended Hosting

- **API + Web**: Railway, Render, or Vercel
- **Database**: MongoDB Atlas (free tier)

Note: API server must be publicly accessible to receive MeetingBaas webhooks.

## Cost Estimate

| Service | Cost |
|---------|------|
| MongoDB Atlas | Free (512MB) |
| Gemini API | ~$1/month |
| MeetingBaas | Pay per meeting |
| Slack | Free |
| **Total** | **~$5-20/month** |

## Troubleshooting

### Bot doesn't join meeting
- Check MeetingBaas API key is valid
- Ensure webhook URL is publicly accessible
- Check API server logs for errors

### Commands not executing
- Commands are processed when the meeting ends
- Check that the transcript contains "Hey Taro" followed by a command
- Verify Slack OAuth tokens are valid

### Slack posting fails
- Verify OAuth tokens are valid
- Check channel name spelling
- Ensure bot is in the channel

## License

MIT
