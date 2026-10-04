# Deploying Taro

Taro has three moving parts:

| Part | What it is | Where it runs well |
|---|---|---|
| **API** (`packages/api`) | Express server, Slack listener, realtime audio sockets | Render, Railway, Fly.io, or any Docker host |
| **Dashboard** (`apps/web`) | Next.js app: landing page, sign in, dashboard | Vercel (or Docker) |
| **Database** | MongoDB | MongoDB Atlas (free tier works to start) |

Each workspace brings its own MeetingBaas key, AI model key, and transcription key in the dashboard. You, the operator, only provide the infrastructure below; you never pay for anyone's meetings or model usage.

The order matters, because each service needs the URLs of the others. Plan two hostnames up front, for example:

- API: `https://api.your-domain.com` (from now on, `API_URL`)
- Dashboard: `https://app.your-domain.com` (`APP_URL`)

Platform default domains (`taro-api.onrender.com`, `taro.vercel.app`) work fine too.

## 1. Database

1. Create a cluster at [mongodb.com/atlas](https://www.mongodb.com/atlas).
2. Add a database user, and allow network access from your API host (`0.0.0.0/0` is simplest for platforms without fixed IPs).
3. Copy the connection string and add a database name: `mongodb+srv://user:pass@cluster.mongodb.net/taro`. That is `MONGODB_URI`.

Taro creates its indexes and runs its migrations on boot.

## 2. Encryption key

```bash
openssl rand -base64 32
```

That is `ENCRYPTION_KEY`. It encrypts every stored provider key and signs sign-in state. Keep it in your host's secret store and back it up: if it is lost or changed, every workspace has to re-enter its keys.

## 3. Slack app

Slack powers sign in, meeting discovery, and result posting.

1. Open `docs/slack-app-manifest.yaml`, replace `YOUR-API-DOMAIN` with your API host, then go to [api.slack.com/apps](https://api.slack.com/apps), choose **Create New App**, **From an app manifest**, and paste it.
2. **Basic Information**, **App-Level Tokens**: generate a token with the `connections:write` scope. That is `SLACK_APP_TOKEN` (starts with `xapp-`).
3. **Basic Information**, **App Credentials**: copy the Client ID and Client Secret into `SLACK_CLIENT_ID` and `SLACK_CLIENT_SECRET`.
4. **Manage Distribution**: activate public distribution so people outside your own Slack workspace can sign in and add Taro. Skip this if Taro is only for your team.

Taro uses Socket Mode, so Slack needs no public events URL; only the two OAuth redirect URLs in the manifest must point at your API.

## 4. GitHub App (optional)

Without it, Taro still works in Slack; the GitHub card is simply hidden.

1. Go to [github.com/settings/apps/new](https://github.com/settings/apps/new).
2. **Homepage URL**: your dashboard URL.
3. **Callback URL**: `API_URL/api/github/callback`.
4. Tick **Request user authorization (OAuth) during installation**. Taro uses this once, when someone connects GitHub, to see which repositories that person can push to. It only ever acts on those, so nobody can use Taro to reach repositories they couldn't change themselves.
5. **Webhook**: untick **Active**.
6. **Repository permissions**: Issues: Read and write. Pull requests: Read and write. Contents: Read and write (needed to create branches for pull requests). Metadata stays read only.
7. **Where can this GitHub App be installed?** Any account. Create the app.
8. On the app's page copy the **App ID** (`GITHUB_APP_ID`), the slug from `github.com/apps/<slug>` (`GITHUB_APP_SLUG`), and the **Client ID** (`GITHUB_APP_CLIENT_ID`).
9. **Generate a new client secret**: `GITHUB_APP_CLIENT_SECRET`.
10. **Generate a private key**, then encode it on one line: `base64 -i your-app.private-key.pem | tr -d '\n'`. That is `GITHUB_APP_PRIVATE_KEY`.

## 5. API

The API needs to stay running (no sleeping instances) and must be reachable over https and WebSockets.

### Render

1. **New**, **Blueprint**, and pick this repository. `render.yaml` defines the service on the free plan.
2. Fill in the environment variables it asks for (sections 1 to 4, plus `API_URL` and `APP_URL`).
3. Deploy, then confirm `API_URL/ready` returns `{"status":"ready"}`.
4. Keep it awake. Free instances sleep after 15 minutes without requests, and a sleeping Taro misses meeting links. Create a free monitor at [uptimerobot.com](https://uptimerobot.com) that requests `API_URL/health` every 5 minutes. For production use, switch the service to a paid instance type instead; those never sleep.

### Railway

1. **New Project**, **Deploy from GitHub repo**.
2. Set the variable `RAILWAY_DOCKERFILE_PATH=packages/api/Dockerfile` and the environment variables below.
3. **Settings**, **Networking**: generate a domain (that is `API_URL`).

### Fly.io

```bash
fly launch --dockerfile packages/api/Dockerfile --no-deploy
fly secrets set MONGODB_URI=... ENCRYPTION_KEY=... API_URL=... APP_URL=... SLACK_CLIENT_ID=... SLACK_CLIENT_SECRET=... SLACK_APP_TOKEN=...
fly scale count 1
fly deploy
```

In `fly.toml`, set `auto_stop_machines = 'off'` and `min_machines_running = 1`, and point the HTTP health check at `/ready`.

### Any Docker host

```bash
docker build -f packages/api/Dockerfile -t taro-api .
docker run -d --env-file .env -p 4000:4000 taro-api
```

Put it behind a reverse proxy that terminates TLS and passes WebSocket upgrades through. `docker-compose.yml` runs MongoDB, the API, and the dashboard together.

### API environment variables

| Variable | Required | Notes |
|---|---|---|
| `MONGODB_URI` | yes | Section 1 |
| `ENCRYPTION_KEY` | yes | Section 2 |
| `API_URL` | yes | Public https URL of the API |
| `APP_URL` | yes | Public URL of the dashboard |
| `SLACK_CLIENT_ID`, `SLACK_CLIENT_SECRET`, `SLACK_APP_TOKEN` | yes | Section 3 |
| `GITHUB_APP_ID`, `GITHUB_APP_SLUG`, `GITHUB_APP_PRIVATE_KEY`, `GITHUB_APP_CLIENT_ID`, `GITHUB_APP_CLIENT_SECRET` | for GitHub | Section 4 |
| `WEB_ORIGINS` | no | Extra trusted dashboard origins, comma separated |
| `EXTENSION_IDS` | for the Meet button | Chrome and Edge extension IDs allowed to call the API (section 7) |
| `TRUST_PROXY_HOPS` | no | Proxies in front of the API. Default 1, right for Render, Railway, and Fly; 0 when clients connect directly |
| `MAX_ACTIVE_MEETINGS_PER_WORKSPACE` | no | Default 5 |
| `BOT_NAME`, `BOT_IMAGE_URL` | no | Defaults: `Taro`, and the logo served by the API |
| `LOG_LEVEL` | no | `info` in production by default; meeting content only appears at `debug` |

`.env.example` documents every option, including self-hosted transcription.

## 6. Dashboard on Vercel

1. [vercel.com/new](https://vercel.com/new): import the repository and set **Root Directory** to `apps/web`.
2. Add environment variables (they are compiled into the site, so redeploy after changing them):
   - `NEXT_PUBLIC_API_URL` = your `API_URL`
   - `NEXT_PUBLIC_SITE_URL` = your `APP_URL`
   - `NEXT_PUBLIC_REPO_URL` = optional link shown in the footer
   - `NEXT_PUBLIC_GITHUB_APP_SLUG` = your API's `GITHUB_APP_SLUG`, so examples name your GitHub App
   - `NEXT_PUBLIC_TARO_EXTENSION_IDS` and `NEXT_PUBLIC_TARO_EXTENSION_URL` only for the Google Meet button (section 7)
3. Deploy. If the Vercel domain is your `APP_URL`, you're done; otherwise add your custom domain and keep `APP_URL` in sync. Preview deployments need their origin in the API's `WEB_ORIGINS` to sign in.

## 7. The Invite Taro button in Google Meet (optional)

`apps/extension` is a Chrome and Edge extension that adds an **Invite Taro** button to Google Meet's bottom bar. Its README covers trying it unpacked, publishing it to the Chrome Web Store and Edge Add-ons, and how a Google Workspace admin force-installs it for a whole company.

1. Publish it (or load it unpacked while testing) and note its extension ID.
2. On the API, set `EXTENSION_IDS` to that ID (comma separate several builds).
3. On the dashboard, set `NEXT_PUBLIC_TARO_EXTENSION_IDS` to the same list, and `NEXT_PUBLIC_TARO_EXTENSION_URL` to the store listing so the dashboard can link to it. They're compiled into the site, so redeploy after changing them. On Vercel they go in the project settings; with Docker they're build arguments, and `docker-compose.yml` fills in the IDs from `EXTENSION_IDS`.

The extension gets a limited connection: it can send Taro to a meeting, check on it, and make Taro leave, and nothing else.

## 8. Check it end to end

1. `API_URL/ready` answers `ready`.
2. Open the dashboard and choose **Sign in with Slack**.
3. Follow **Set up Taro**: add Taro to Slack (whoever does becomes the workspace's owner), paste a MeetingBaas key, choose an AI model, turn on transcription.
4. Post a Google Meet, Zoom, or Teams link in a public channel, admit Taro from the lobby, and say "Hey Taro, post hello to general".

## Running at scale

- **One API instance per deployment.** A meeting's realtime session lives in the memory of the instance MeetingBaas connects to. Transcription and reasoning run on each workspace's own cloud providers, so a single instance mostly relays audio and handles many concurrent meetings; scale it up (CPU and memory) rather than out. If you do run several, route each meeting's sockets to one instance with sticky sessions.
- **Slack Socket Mode** delivers each event to one open connection, so extra instances never double handle a link.
- **Per-workspace limits**: `MAX_ACTIVE_MEETINGS_PER_WORKSPACE` and per-workspace rate limits on sending Taro to meetings protect each workspace's own MeetingBaas bill.
- **Database**: indexes cover every hot query (sessions, meetings by workspace, bot lookups). Expired sessions and sign-in codes are removed automatically by TTL indexes.
- **Deploys**: on shutdown Taro closes live sessions cleanly, but a meeting in progress can lose its audio connection, so deploy between meetings when you can.

## Security notes

- Provider keys are validated with the provider, encrypted with AES-256-GCM (bound to their workspace), and never sent back to a browser.
- Only owners and admins change keys and connections. Whoever adds Taro to Slack becomes the owner, Slack owners and admins are promoted to match, and owners manage everyone else from **Members**. Slack guests can't sign in, and someone deactivated in Slack is signed out within the hour. Sessions last 30 days from last use and 90 days at most.
- GitHub actions only reach repositories the person who connected GitHub can push to, using tokens limited to the one repository Taro is working in.
- Every MeetingBaas callback and audio socket carries a per-meeting secret; nothing else can feed audio into a meeting or report results for it.
- Custom AI endpoints are limited to public https addresses, checked when the connection opens, so a workspace can't point Taro at your internal network.
- If a MeetingBaas or other provider key was ever committed to git (an old `.env.example` in this repository contained one), rotate it with the provider.
