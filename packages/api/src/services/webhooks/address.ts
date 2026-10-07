/**
 * Where a webhook may go. A workspace types in any URL, and Taro's server makes the request, so the
 * URL must never reach the server's own network: loopback, private ranges, link-local (where cloud
 * metadata lives), carrier NAT, and their IPv6 equivalents are refused. The host is resolved here
 * and the request connects to the address that was checked, so a DNS answer that changes between
 * the check and the connection can't point it somewhere else.
 */

import dns from 'dns/promises';
import net from 'net';

export class WebhookUrlError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'WebhookUrlError';
  }
}

const blocked = new net.BlockList();
for (const [range, bits] of [
  ['0.0.0.0', 8], // "this network"
  ['10.0.0.0', 8],
  ['100.64.0.0', 10], // carrier NAT
  ['127.0.0.0', 8],
  ['169.254.0.0', 16], // link-local, including cloud metadata
  ['172.16.0.0', 12],
  ['192.0.0.0', 24],
  ['192.0.2.0', 24],
  ['192.168.0.0', 16],
  ['198.18.0.0', 15],
  ['198.51.100.0', 24],
  ['203.0.113.0', 24],
  ['224.0.0.0', 4], // multicast
  ['240.0.0.0', 4], // reserved and broadcast
] as const) {
  blocked.addSubnet(range, bits, 'ipv4');
}
for (const [range, bits] of [
  ['::', 128],
  ['::1', 128],
  ['100::', 64], // discard
  ['2001:db8::', 32], // documentation
  ['fc00::', 7], // unique local
  ['fe80::', 10], // link-local
  ['ff00::', 8], // multicast
] as const) {
  blocked.addSubnet(range, bits, 'ipv6');
}

// IPv6 forms that carry an IPv4 address: mapped (::ffff:a.b.c.d) and NAT64 (64:ff9b::a.b.c.d).
function embeddedIpv4(address: string): string | null {
  const lower = address.toLowerCase();
  const dotted = lower.match(/^(?:::ffff:|64:ff9b::)(\d+\.\d+\.\d+\.\d+)$/);
  if (dotted) return dotted[1];
  const hex = lower.match(/^(?:::ffff:|64:ff9b::)([0-9a-f]{1,4}):([0-9a-f]{1,4})$/);
  if (!hex) return null;
  const high = parseInt(hex[1], 16);
  const low = parseInt(hex[2], 16);
  return [high >> 8, high & 255, low >> 8, low & 255].join('.');
}

/** True for an address on the public internet. */
export function isPublicAddress(address: string): boolean {
  const family = net.isIP(address);
  if (family === 4) return !blocked.check(address, 'ipv4');
  if (family !== 6) return false;
  const v4 = embeddedIpv4(address);
  if (v4) return isPublicAddress(v4);
  // Mapped and NAT64 forms that didn't parse are refused rather than guessed at
  if (/^(::ffff:|64:ff9b::)/i.test(address)) return false;
  return !blocked.check(address, 'ipv6');
}

const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '::1']);

/** Checks the shape of a URL and returns it normalized. Doesn't touch the network. */
export function parseWebhookUrl(raw: unknown, opts: { allowLocal: boolean }): URL {
  if (typeof raw !== 'string' || !raw.trim()) throw new WebhookUrlError('Enter the URL to send events to.');
  if (raw.trim().length > 2000) throw new WebhookUrlError('That URL is too long.');
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    throw new WebhookUrlError("That isn't a full URL. It should start with https://.");
  }
  if (url.username || url.password) throw new WebhookUrlError('Leave the user name and password out of the URL.');
  const host = url.hostname.replace(/^\[|\]$/g, '');
  const local = LOCAL_HOSTS.has(host);
  if (url.protocol === 'http:' && local && opts.allowLocal) return url;
  if (url.protocol !== 'https:') throw new WebhookUrlError('Use an https:// URL.');
  if (local && !opts.allowLocal) throw new WebhookUrlError("Taro can't send to this server's own address.");
  url.hash = '';
  return url;
}

export interface ResolvedTarget {
  url: URL;
  address: string;
  family: 4 | 6;
}

type Lookup = (host: string) => Promise<Array<{ address: string; family: number }>>;

const systemLookup: Lookup = (host) => dns.lookup(host, { all: true, verbatim: true });

/**
 * Resolves the URL's host and picks the address to connect to. Every address the name has must be
 * public: one private answer among public ones is how rebinding tricks start.
 */
export async function resolveWebhookTarget(
  raw: unknown,
  opts: { allowLocal: boolean; lookup?: Lookup }
): Promise<ResolvedTarget> {
  const url = parseWebhookUrl(raw, opts);
  const host = url.hostname.replace(/^\[|\]$/g, '');
  const local = opts.allowLocal && LOCAL_HOSTS.has(host);

  let answers: Array<{ address: string; family: number }>;
  if (net.isIP(host)) {
    answers = [{ address: host, family: net.isIP(host) }];
  } else {
    try {
      answers = await (opts.lookup ?? systemLookup)(host);
    } catch {
      throw new WebhookUrlError(`Couldn't find ${host}. Check the address.`);
    }
  }
  if (answers.length === 0) throw new WebhookUrlError(`Couldn't find ${host}. Check the address.`);
  if (!local && answers.some((a) => !isPublicAddress(a.address))) {
    throw new WebhookUrlError(`${host} points to a private or reserved address, so Taro won't send to it.`);
  }
  // IPv4 first: more receivers listen on it, and localhost often answers ::1 first
  const pick = answers.find((a) => a.family === 4) ?? answers[0];
  return { url, address: pick.address, family: pick.family === 6 ? 6 : 4 };
}
