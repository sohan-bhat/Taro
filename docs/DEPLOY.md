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

## 3. Sign-in and Slack

People sign in with Google or Slack, and the sign-in page shows only the ones you set up. Whoever signs in with a Google Workspace account joins the Taro workspace for that domain, and a Slack account joins the one for its Slack workspace. Personal Google accounts each get a workspace of their own. Set up Slack, Google, or both.

### Slack app

Slack powers Slack sign-in, meeting links posted in channels, and result posting. Workspaces made by Google sign-in can add it from Setup whenever they like.

1. Open `docs/slack-app-manifest.yaml`, replace `YOUR-API-DOMAIN` with your API host, then go to [api.slack.com/apps](https://api.slack.com/apps), choose **Create New App**, **From an app manifest**, and paste it.
2. **Basic Information**, **App-Level Tokens**: generate a token with the `connections:write` scope. That is `SLACK_APP_TOKEN` (starts with `xapp-`).
3. **Basic Information**, **App Credentials**: copy the Client ID and Client Secret into `SLACK_CLIENT_ID` and `SLACK_CLIENT_SECRET`.
4. **Manage Distribution**: activate public distribution so people outside your own Slack workspace can sign in and add Taro. Skip this if Taro is only for your team.

Taro uses Socket Mode, so Slack needs no public events URL; only the two OAuth redirect URLs in the manifest must point at your API.

### Sign in with Google (optional)

Taro asks Google only for the three basic sign-in scopes, so Google doesn't need to review the app.

1. In the [Google Cloud console](https://console.cloud.google.com), create a project for Taro, or pick an existing one.
2. Open **Google Auth Platform** (it was **APIs & Services**, **OAuth consent screen**). Under **Branding**, give the app a name (Taro), a support email, and your dashboard's address as its home page.
3. Under **Audience**, choose **External**, then **Publish app** so its status is **In production**. While it's in testing, only the test users you list there can sign in.
4. Under **Data Access**, add only `openid`, `.../auth/userinfo.email`, and `.../auth/userinfo.profile`. All three are non-sensitive.
5. Under **Clients**, **Create client**: choose **Web application**, and add `API_URL/api/auth/google/callback` under **Authorized redirect URIs**, for example `https://api.your-domain.com/api/auth/google/callback`.
6. Copy the client ID and client secret into `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET`.

Google shows your app's name and logo on its sign-in screen once the brand is verified (under **Branding**). Sign-in works before that.

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
| `SLACK_CLIENT_ID`, `SLACK_CLIENT_SECRET`, `SLACK_APP_TOKEN` | for Slack | Section 3. At least one way to sign in (Slack or Google) is required |
| `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` | for Google sign-in | Section 3 |
| `GITHUB_APP_ID`, `GITHUB_APP_SLUG`, `GITHUB_APP_PRIVATE_KEY`, `GITHUB_APP_CLIENT_ID`, `GITHUB_APP_CLIENT_SECRET` | for GitHub | Section 4 |
| `WEB_ORIGINS` | no | Extra trusted dashboard origins, comma separated |
| `EXTENSION_IDS` | for the Meet button | Chrome and Edge extension IDs allowed to call the API (section 7) |
| `INVITE_ADDRESS`, `INBOUND_SECRET` | for calendar invitations | Section 9 |
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
2. Open the dashboard and sign in with Google or Slack.
3. Follow **Setup**: paste a MeetingBaas key, choose an AI model, turn on transcription. In a Slack workspace, add Taro to Slack first (whoever does becomes the workspace's owner). In a Google workspace, the first person to sign in is the owner, and adding Slack is optional.
4. Post a Google Meet, Zoom, or Teams link in a public channel, admit Taro from the lobby, and say "Hey Taro, post hello to general".

## 9. Calendar invitations (optional)

People add their workspace's Taro address to a meeting invite, once for a recurring series, and Taro joins at the start. Taro never reads anyone's calendar. The invitation email that every calendar sends its guests carries a calendar file saying when and where, and updates and cancellations arrive the same way. It works with Google Calendar and Outlook, and with Google Meet, Zoom, and Microsoft Teams links.

How it works:

- Each workspace has its own address: `INVITE_ADDRESS` with a long random token in place of `{token}`. Everyone sees it in **Setup** under **Calendar**, with **Copy address**; owners and admins can **Rotate** it, which retires the old one at once.
- Mail to those addresses reaches `POST API_URL/api/inbound/email`, guarded by `INBOUND_SECRET`, sent as the password of HTTP basic auth or in an `X-Inbound-Secret` header.
- An invitation joins on its own when a member of the workspace sent it, or organized it and the mail came from them (or from Google Calendar on their behalf). A member is someone signed in to Taro with that email, anyone at a Google workspace's own domain, or, when Taro's Slack bot has `users:read.email`, a full member of the connected Slack workspace. Everything else waits under **Upcoming** in **Meetings** for an owner or admin to approve or decline it.
- For each meeting it will join, Taro schedules a MeetingBaas bot with the workspace's own key, and MeetingBaas sends it in at the start. When a meeting moves, is canceled, or someone clicks **Skip**, the bot moves or is canceled. Removing one of the workspace's keys cancels its bots, and a new MeetingBaas key replaces them. Five minutes before the start Taro confirms the bot, and sends one itself if the scheduled bot failed. A meeting more than 10 minutes past its start is skipped rather than joined late.

Generate the secret first. It's hex so it can sit in a URL:

```bash
openssl rand -hex 32
```

You need one of the two ways below to receive the mail. Neither needs anything from Google or Microsoft. Choose before people start using it: changing `INVITE_ADDRESS` later changes every workspace's address, and meetings that list an old address stop getting updates.

### Option A: Postmark inbound (no domain needed)

1. Create a [Postmark](https://postmarkapp.com) account and a server, and open its **Default Inbound Stream**.
2. Its **Settings** show the stream's inbound address, like `abc123def456@inbound.postmarkapp.com`. Set `INVITE_ADDRESS` to that address with `+{token}` before the @: `abc123def456+{token}@inbound.postmarkapp.com`. Postmark delivers every plus address to the same stream.
3. Set the stream's **Webhook URL** to `https://taro:YOUR_INBOUND_SECRET@your-api-host/api/inbound/email`. The secret is the basic auth password; the user name can be anything.
4. Turn on the setting that includes the raw email content in the JSON payload. Outlook puts its invitation inside the message rather than attaching a file, and the raw message is how Taro finds it.
5. Set `INVITE_ADDRESS` and `INBOUND_SECRET` on the API and redeploy. The dashboard shows the **Calendar** row in **Setup** once both are set.

Postmark bills by message, and each invitation, update, and cancellation is one message.

### Option B: your own domain with Cloudflare Email Routing

1. Pick a domain or subdomain whose DNS is on Cloudflare, for example `invite.your-domain.com`. In the Cloudflare dashboard, open **Email Routing** (under **Compute**, **Email Service**), enable it, and add the DNS records it asks for. For a subdomain, open the main domain's Email Routing **Settings** and add it under **Subdomains**.
2. Create a Worker from `docs/calendar-email-worker.js`. Give it the variable `TARO_INBOUND_URL` = `https://your-api-host/api/inbound/email` and the secret `TARO_INBOUND_SECRET` = your `INBOUND_SECRET` (with Wrangler: `wrangler secret put TARO_INBOUND_SECRET`).
3. In Email Routing's **Routing rules**, turn on the **Catch-all address** with the action **Send to a Worker**, and choose the worker.
4. Set `INVITE_ADDRESS={token}@invite.your-domain.com` and `INBOUND_SECRET` on the API, and redeploy.

The worker posts each message on unchanged, with the address it was delivered to. It turns away addresses that can't be a Taro address, so the catch-all doesn't forward everything sent to the domain, and messages over 10 MB.

To use plus addressing on a domain you already receive mail on instead: turn on subaddressing in Email Routing's settings, add a rule sending `taro@your-domain.com` to the worker, set the worker's `TARO_ADDRESS_PATTERN` to `^taro\+[0-9a-z]{20}@`, and set `INVITE_ADDRESS=taro+{token}@your-domain.com`.

### What people see

- **Organizers** add the address as a guest. Google Calendar may warn that it's outside the organization; confirm. Some companies' admins block outside guests, and then Taro can't be invited; post the link or paste it in the dashboard instead.
- **Guests** see Taro's address on the guest list like any other guest. Taro doesn't reply to the invitation.
- **At the start**, Taro asks to join from the lobby, like any guest, under the workspace's bot name, and someone in the meeting admits it. Inside the call nothing changes: "Hey Taro" and a request.
- **In the dashboard**, the meeting appears in **Meetings** with the event's title and "from the calendar". If the workspace isn't set up when the meeting starts, the meeting says what's missing instead of quietly not happening.

## Running at scale

- **One API instance per deployment.** A meeting's realtime session lives in the memory of the instance MeetingBaas connects to. Transcription and reasoning run on each workspace's own cloud providers, so a single instance mostly relays audio and handles many concurrent meetings; scale it up (CPU and memory) rather than out. If you do run several, route each meeting's sockets to one instance with sticky sessions.
- **Slack Socket Mode** delivers each event to one open connection, so extra instances never double handle a link.
- **Calendar invitations**: every API instance runs the calendar's 30 second clock, and each due meeting is taken with one atomic database update, so two instances never send Taro twice. Recurring series are kept two weeks ahead and extended daily; old invitation records expire a week after their meetings end.
- **Per-workspace limits**: `MAX_ACTIVE_MEETINGS_PER_WORKSPACE` and per-workspace rate limits on sending Taro to meetings protect each workspace's own MeetingBaas bill.
- **Database**: indexes cover every hot query (sessions, meetings by workspace, bot lookups). Expired sessions and sign-in codes are removed automatically by TTL indexes.
- **Deploys**: on shutdown Taro closes live sessions cleanly, but a meeting in progress can lose its audio connection, so deploy between meetings when you can.

## Security notes

- Provider keys are validated with the provider, encrypted with AES-256-GCM (bound to their workspace), and never sent back to a browser.
- Only owners and admins change keys and connections. In a Slack workspace, whoever adds Taro to Slack becomes the owner, Slack owners and admins are promoted to match, and owners manage everyone else from **Members**. Slack guests can't sign in, and someone deactivated in Slack is signed out within the hour. In a Google workspace, the first person to sign in is the owner and everyone after joins as a member until an owner promotes them. Sessions last 30 days from last use and 90 days at most.
- Sign-in is authentication only. Taro asks Google and Slack for `openid`, `email`, and `profile`, checks that each ID token was issued to Taro for that very sign-in, and keeps no provider access token. Google workspaces are matched by the Google Workspace domain in the token, never by an email address.
- A Slack workspace belongs to one Taro workspace at most. A Google workspace can't add a Slack workspace that another Taro workspace already has, and someone signing in with Slack from a Slack workspace that a Google workspace added is sent to sign in with Google instead.
- GitHub actions only reach repositories the person who connected GitHub can push to, using tokens limited to the one repository Taro is working in.
- Every MeetingBaas callback and audio socket carries a per-meeting secret; nothing else can feed audio into a meeting or report results for it.
- The calendar webhook is public, so it treats every message as hostile. It checks `INBOUND_SECRET` in constant time before reading anything, caps message size, reads only calendar parts, follows no links, and routes mail only by the token in the address it was sent to, so one workspace's mail never reaches another. Invitations nobody in the workspace vouched for wait for approval, and so do changes to an approved meeting's time or link that arrive in such mail. For each invitation Taro keeps the title, times, link, organizer, and sender, never the description or guest list.
- Custom AI endpoints are limited to public https addresses, checked when the connection opens, so a workspace can't point Taro at your internal network.
- If a MeetingBaas or other provider key was ever committed to git (an old `.env.example` in this repository contained one), rotate it with the provider.
