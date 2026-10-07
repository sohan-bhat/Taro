# Webhooks

Taro can send what happens in your meetings to your own tools: Zapier, n8n, Make, or a server you run. An owner or admin adds endpoints in **Setup → Optional → Webhooks**. A workspace can have up to 5.

## Events

| Event | Sent when | `data` holds |
|---|---|---|
| `meeting.started` | Taro is in a call and hearing it | `meeting` |
| `meeting.ended` | The call is over | `meeting`, `recap` (the lines Taro posted), `requests`, `transcript`, `transcriptTruncated` |
| `request.completed` | Taro handled one spoken request | `meetingId`, `request` |
| `webhook.test` | Someone pressed **Send test** | `endpointId`, `message` |

Each endpoint chooses which of the first three it gets. A test only goes to the endpoint it was sent from.

## The request

Every event is a `POST` with a JSON body:

```json
{
  "id": "evt_Jx3...",
  "type": "request.completed",
  "createdAt": "2026-10-07T17:04:12.381Z",
  "workspaceId": "66f0...",
  "data": {
    "meetingId": "66f1...",
    "request": {
      "command": "file an issue about the export timing out",
      "action": "create_github_issue",
      "params": { "title": "Export times out on large accounts", "body": "## Summary..." },
      "outcome": "done",
      "summary": "Opened issue #12 (https://github.com/acme/app/issues/12) in acme/app.",
      "url": "https://github.com/acme/app/issues/12",
      "at": "2026-10-07T17:04:12.377Z"
    }
  }
}
```

`outcome` is `done`, `needs_you` (Taro asked a question back), `turned_off` (the workspace doesn't allow it), or `failed`. `url` is set when something was made or changed.

A `meeting` looks like this:

```json
{
  "id": "66f1...",
  "title": "Weekly sync",
  "url": "https://meet.google.com/abc-defg-hij",
  "platform": "google_meet",
  "source": "google_calendar",
  "status": "ended",
  "startedBy": "Priya",
  "startedAt": "2026-10-07T17:00:03.000Z",
  "endedAt": "2026-10-07T17:31:40.000Z"
}
```

Transcripts longer than 200,000 characters are cut, and `transcriptTruncated` is `true`.

Headers:

| Header | Value |
|---|---|
| `Taro-Event` | The event type |
| `Taro-Delivery` | The ID of this delivery. Retries of it keep the same ID. |
| `Taro-Signature` | `t=<unix seconds>,v1=<hex signature>` |
| `User-Agent` | `Taro-Webhooks/1` |

## Answering, and retries

Answer with any `2xx` within 10 seconds. Anything else is a failure, including a redirect: Taro doesn't follow them, so give it the final URL. A failed delivery is tried again after 30 seconds, 5 minutes, 30 minutes, and 2 hours, then given up. An event can arrive more than once, so use `id` to skip ones you've seen.

If every delivery to an endpoint fails for 3 days, Taro turns it off and says so in Setup. Turn it back on from the endpoint's settings.

Taro only sends to `https` URLs on the public internet. Addresses that resolve to private, loopback, or link-local networks are refused.

## Checking the signature

Each endpoint has a signing secret, shown once when you add it or rotate it. The signature is an HMAC SHA256 of the timestamp, a period, and the raw body, keyed with the whole secret. Check it against the raw body before you parse it, and refuse old timestamps so a captured request can't be replayed.

```js
import crypto from 'node:crypto';
import express from 'express';

const SECRET = process.env.TARO_WEBHOOK_SECRET; // whsec_...

function verify(rawBody, header) {
  const parts = Object.fromEntries(header.split(',').map((p) => p.split('=')));
  const t = Number(parts.t);
  if (!t || Math.abs(Date.now() / 1000 - t) > 300) return false;
  const expected = crypto.createHmac('sha256', SECRET).update(`${t}.${rawBody}`).digest('hex');
  const given = Buffer.from(parts.v1 ?? '', 'hex');
  return given.length === 32 && crypto.timingSafeEqual(given, Buffer.from(expected, 'hex'));
}

const app = express();
app.post('/taro', express.raw({ type: 'application/json' }), (req, res) => {
  if (!verify(req.body.toString('utf8'), req.get('Taro-Signature') ?? '')) return res.sendStatus(400);
  const event = JSON.parse(req.body);
  console.log(event.type, event.data);
  res.sendStatus(204);
});
app.listen(3001);
```

Rotating a secret replaces it at once, so update your receiver right after.
