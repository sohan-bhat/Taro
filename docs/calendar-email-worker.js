/**
 * Cloudflare Email Worker for Taro's calendar invitations (docs/DEPLOY.md, section 9, option B).
 *
 * Email Routing hands this worker each message sent to your invite domain. It posts the message,
 * unchanged, to Taro's webhook, which reads the calendar invitation inside and ignores the rest.
 *
 * Variables on the worker:
 *   TARO_INBOUND_URL      https://your-api-host/api/inbound/email
 *   TARO_INBOUND_SECRET   the API's INBOUND_SECRET (add it as a secret, not plain text)
 *   TARO_ADDRESS_PATTERN  optional: a regular expression every recipient must match. The default fits
 *                         INVITE_ADDRESS={token}@...; for taro+{token}@your-domain.com use ^taro\+[0-9a-z]{20}@
 */

// Taro reads up to 12 MB a message; anything bigger is turned away here.
const MAX_BYTES = 10 * 1024 * 1024;

export default {
  async email(message, env) {
    const pattern = new RegExp(env.TARO_ADDRESS_PATTERN || '^[0-9a-z]{20}@', 'i');
    // A catch-all hears everything sent to the domain. Only addresses shaped like Taro's go on.
    if (!pattern.test(message.to)) {
      message.setReject('Unknown address');
      return;
    }
    if (message.rawSize > MAX_BYTES) {
      message.setReject('Message too large');
      return;
    }

    const response = await fetch(env.TARO_INBOUND_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'message/rfc822',
        'X-Inbound-Secret': env.TARO_INBOUND_SECRET,
        // The address this copy was delivered to, which a Bcc leaves out of the headers
        'X-Envelope-To': message.to,
      },
      body: await new Response(message.raw).arrayBuffer(),
    });

    // Taro answers 200 even for mail it can't use. Anything else means the URL, the secret, or the
    // API is wrong; failing here records the delivery as failed in Email Routing's activity log.
    if (!response.ok) throw new Error(`Taro answered ${response.status}`);
  },
};
