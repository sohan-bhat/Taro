# Taro - Voice-Activated Meeting Assistant

Taro is a voice-activated meeting assistant that joins Google Meet calls, listens for commands ("Hey Taro..."), and executes actions in Slack.

## How it works

1. Someone posts a Google Meet link in a public Slack channel
2. Taro detects it and joins the meeting as a bot (via MeetingBaas)
3. During the meeting, anyone says **"Hey Taro, make a todo list in the project channel about X, Y and Z"**
4. When the meeting ends, MeetingBaas delivers the transcript, Taro extracts the command, parses intent with Gemini, and executes it in Slack
5. Taro reports what it did in the thread where the meeting link was posted

Commands execute **live, mid-meeting**: MeetingBaas streams the call audio (16kHz PCM over WebSocket) to the API server, which transcribes it locally with sherpa-onnx, detects "Hey Taro" as you speak, executes the action immediately, and plays a **ding** into the call as confirmation. A post-meeting sweep of the official transcript acts as a fallback for anything the live path missed.

## Voice Commands

| Command | Example |
|---------|---------|
| Post message | "Hey Taro, post hello world to general" |
| Create todo list | "Hey Taro, make a todo list in the project channel about reviewing the PR, fixing the deploy and emailing the client" |
| File GitHub issue | "Hey Taro, create an issue about the login button being broken on Safari" |

## Project Structure

```
taro/
├── apps/
│   └── web/          # Next.js dashboard (onboarding + meeting/command log)
├── packages/
│   ├── api/          # Express API server (Slack listener, MeetingBaas webhooks, intent parsing)
│   └── shared/       # Shared types & constants
└── docs/
    └── slack-app-manifest.yaml   # Paste into api.slack.com/apps to create the Slack app
```

## Quick Start

### Prerequisites

- Node.js 20+
- pnpm 9+
- MongoDB Atlas account (free tier)
- Google AI Studio API key (free, for Gemini intent parsing)
- Slack workspace where you can install apps
- MeetingBaas API key (free tier: 75 bots/day)
- ngrok account with a static domain (free)

### 1. Install dependencies

```bash
pnpm install
```

### 1b. Download the local speech model (realtime commands)

Realtime transcription runs locally via sherpa-onnx. No API key, no cost.
The model (~300MB) is not committed; download it once per machine:

```bash
mkdir -p packages/api/models && cd packages/api/models
curl -sL -O "https://github.com/k2-fsa/sherpa-onnx/releases/download/asr-models/sherpa-onnx-streaming-zipformer-en-2023-06-26.tar.bz2"
tar xjf sherpa-onnx-streaming-zipformer-en-2023-06-26.tar.bz2 && rm *.tar.bz2
cd ../../..
```

For the most accurate transcription, Taro uses hotword biasing, which needs a
`bpe.vocab` generated once from the model's `bpe.model`:

```bash
pip3 install sentencepiece
python3 - <<'PY'
import sentencepiece as spm
d = "packages/api/models/sherpa-onnx-streaming-zipformer-en-2023-06-26"
sp = spm.SentencePieceProcessor(model_file=f"{d}/bpe.model")
open(f"{d}/bpe.vocab","w").write("".join(f"{sp.id_to_piece(i)} {sp.get_score(i)}\n" for i in range(sp.vocab_size())))
PY
```

If the model is missing the server still runs: it logs `Realtime ASR: UNAVAILABLE`
and falls back to post-meeting command processing.

For much higher live-transcription accuracy (still 100% local and free), run the
optional faster-whisper server in `packages/api/stt-server` and set
`STT_WS_URL=ws://localhost:8012` in the API `.env`. See that folder's README.

### 2. Set up external services

#### ngrok (do this first, Slack config needs the domain)
1. Sign up at [ngrok.com](https://ngrok.com), claim your free static domain
2. Run: `ngrok http 4000 --domain=<your-domain>.ngrok-free.app`

#### Slack app
1. Go to [api.slack.com/apps](https://api.slack.com/apps) → Create New App → **From an app manifest**
2. Paste `docs/slack-app-manifest.yaml` (replace `YOUR-NGROK-DOMAIN` first)
3. Basic Information → App-Level Tokens → create a token with `connections:write` scope → this is `SLACK_APP_TOKEN`
4. Copy the Client ID and Client Secret

#### MongoDB Atlas
1. Create a free cluster at [mongodb.com/atlas](https://www.mongodb.com/atlas)
2. Create a database user, allow your IP, copy the connection string

#### Google Gemini
1. Get a free API key at [aistudio.google.com](https://aistudio.google.com)

#### MeetingBaas
1. Sign up at [meetingbaas.com](https://meetingbaas.com), copy your API key

#### GitHub App (optional, for voice-filed issues)
Taro files issues as its own bot identity (`<app-name>[bot]`), never through a person's account. Create the app once per deployment:
1. Go to [github.com/settings/apps/new](https://github.com/settings/apps/new)
2. **GitHub App name**: e.g. `Taro Meeting Assistant` (must be globally unique). **Homepage URL**: your dashboard URL
3. **Setup URL**: `https://<your-ngrok-domain>/api/github/callback`, and tick **Redirect on update**
4. **Webhook**: untick **Active**
5. **Repository permissions**: **Issues: Read and write** (Metadata becomes read-only automatically). Add **Pull requests: Read and write** if you want PR features later
6. **Where can this GitHub App be installed?**: Any account. Click **Create GitHub App**
7. Copy the **App ID** from the top of the settings page, and the slug from the public link (`github.com/apps/<slug>`)
8. Scroll down and **Generate a private key** (downloads a `.pem`). Put all three in `.env`: `GITHUB_APP_ID`, `GITHUB_APP_SLUG`, and `GITHUB_APP_PRIVATE_KEY` as the output of `base64 -i <file>.pem | tr -d '\n'`

Restart the API after editing `.env`. Companies then install the app from the dashboard (Integrations → GitHub → Install), grant it the repos they want, and pick the default repo issues go to.

### 3. Configure environment

```bash
cp .env.example .env
# fill in every value (see comments in the file)
```

### 4. Run

```bash
# Terminal 1: ngrok tunnel (webhooks + OAuth callback)
ngrok http 4000 --domain=<your-domain>.ngrok-free.app

# Terminal 2: API server
pnpm --filter @taro/api dev

# Terminal 3: Web dashboard
pnpm --filter @taro/web dev
```

### 5. Test the flow

1. Issue a license key (this stands in for the purchase): `pnpm --filter @taro/api issue-license` prints a fresh `TARO-XXXX-XXXX-XXXX` key
2. Open http://localhost:3000, enter the key, and activate your workspace (company name + email domain). Licensing follows the industry model (Adobe-style redemption): the key is redeemed once, the browser holds a workspace access token from then on, and the key doubles as proof of purchase to sign back in from a new browser. `pnpm --filter @taro/api revoke-license <key>` kills a workspace's access instantly
3. Follow the first-run onboarding: connect Slack (Taro auto-joins all public channels; for channels created later, `/invite @taro`)
   - Optionally install the Taro GitHub app on your repo from the dashboard (needs the GitHub App env vars above) and pick the repo issues go to
4. Post a Google Meet URL in any **public** Slack channel the bot is in
5. Taro replies in-thread and joins the meeting. **Admit it from the Meet lobby**
6. Say: *"Hey Taro, make a todo list in the general channel about testing the demo and recording the video"* or, with GitHub connected: *"Hey Taro, file an issue about the signup page crashing"*
7. Watch the command execute live, mid-meeting, with a ding in the call
8. When the meeting ends, Taro reports everything it did back in the original thread

### Tests

```bash
pnpm --filter @taro/api test   # wake-word extraction & transcript parsing
```

## Deploy the dashboard to Vercel

The dashboard (Next.js) deploys to Vercel's free tier; the API keeps running on
your machine behind ngrok.

1. Push the repo to GitHub, then at [vercel.com/new](https://vercel.com/new) import it.
2. Set **Root Directory** to `apps/web` (Settings → General → Root Directory).
   Vercel auto-detects Next.js and installs the pnpm workspace (which links
   `@taro/shared`) from there. Leave the build/output settings on their defaults.
3. Add one **Environment Variable** before deploying (it is inlined at build time):
   - `NEXT_PUBLIC_API_URL` = your ngrok URL, e.g. `https://elementary-maverick-mindlessly.ngrok-free.dev`
4. Deploy. Your dashboard is now at `https://<project>.vercel.app`.

Then point the API back at the deployed dashboard so OAuth redirects land there.
In the API's `.env`, set `NEXT_PUBLIC_APP_URL=https://<project>.vercel.app` and
restart the API. Also update the Slack app's redirect URL and the GitHub App's
setup URL only if you move the API off ngrok; while the API stays on ngrok they
are unchanged.

Later, to run the API on an always-on box (that old laptop), install Node + pnpm
there, `pnpm --filter @taro/api dev` (or `build` + `start`), and run ngrok on it
with your static domain so `API_URL` never changes.

## Architecture

```
Slack message ──▶ SlackListener (Socket Mode)
                        │  detects meet.google.com link
                        ▼
                MeetingBaas API (bot joins call, records)
                        │  meeting ends
                        ▼
                Webhook: complete ──▶ transcript flattened
                        │              "hey taro" commands extracted
                        ▼
                Gemini (structured JSON intent) ──▶ Slack Web API
                        │                             post message / todo list
                        ▼
                Results threaded back to the original Slack message
```

## Troubleshooting

### Bot doesn't join the meeting
- **Is the Taro bot a member of the channel?** Slack only delivers channel messages to apps that are members. Channels are auto-joined when you connect Slack; for channels created after that, run `/invite @taro`.
- Is `ngrok` running with the domain in `API_URL`?
- Is `SLACK_APP_TOKEN` set? (Socket Mode listener logs "Connected to Slack" on boot)
- Is the channel **public** and the message a plain `meet.google.com/xxx-xxxx-xxx` link?
- Check the API server logs for `[MeetingBaas] Join failed`

### Commands not executing
- Live commands need the local ASR model (step 1b). Without it, commands run when the meeting **ends**, so leave the meeting fully
- Expand the meeting in the dashboard: the transcript shows exactly what was heard
- Look for `⚠️ regex fallback` in the command log. That means Gemini failed and the API logs have the error

### Slack posting fails
- The target channel must be **public** (the bot auto-joins public channels only)
- Check the channel name matches what was spoken

### GitHub issue creation fails
- "No repository selected": pick the default repo in the dashboard's GitHub card
- 403 or 404 at execution: the app was uninstalled from that repo, or lost **Issues: Read and write**. Reinstall from the dashboard
- Installation tokens are minted automatically (valid 1 hour, cached). Nothing expires on your side

## License

MIT
