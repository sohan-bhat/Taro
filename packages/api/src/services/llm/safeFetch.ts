/**
 * fetch for user-supplied endpoints (the "Custom" AI provider). On a shared
 * server, a workspace must not be able to point Taro at internal addresses
 * (cloud metadata, the database, localhost), so private and reserved IPs are
 * refused at connect time, after DNS resolution. Checking at connect time
 * rather than before the request is what defeats DNS rebinding. Redirects are
 * refused for the same reason. Self-hosters who want a local model (Ollama on
 * localhost) can set ALLOW_PRIVATE_LLM_ENDPOINTS=1.
 */

import dns from 'dns';
import net from 'net';
import { Agent, fetch as undiciFetch } from 'undici';

const allowPrivate = process.env.ALLOW_PRIVATE_LLM_ENDPOINTS === '1';

// Node's BlockList compares numerically, so every spelling of an address
// (hex, IPv4-mapped IPv6, compressed zeros) hits the same rule.
const blocked = new net.BlockList();
for (const [base, prefix] of [
  ['0.0.0.0', 8], ['10.0.0.0', 8], ['100.64.0.0', 10], ['127.0.0.0', 8], ['169.254.0.0', 16],
  ['172.16.0.0', 12], ['192.0.0.0', 24], ['192.0.2.0', 24], ['192.88.99.0', 24], ['192.168.0.0', 16],
  ['198.18.0.0', 15], ['198.51.100.0', 24], ['203.0.113.0', 24], ['224.0.0.0', 4], ['240.0.0.0', 4],
] as const) {
  blocked.addSubnet(base, prefix, 'ipv4');
}
for (const [base, prefix] of [
  // IPv4-mapped addresses (::ffff:a.b.c.d) are checked against the IPv4 rules above
  ['::', 96], // unspecified, loopback, and IPv4-compatible
  ['64:ff9b::', 96], // NAT64, which can reach internal IPv4
  ['64:ff9b:1::', 48],
  ['100::', 64],
  ['2001::', 23],
  ['2001:db8::', 32],
  ['2002::', 16], // 6to4 embeds an IPv4 address
  ['fc00::', 7],
  ['fe80::', 10],
  ['fec0::', 10],
  ['ff00::', 8],
] as const) {
  blocked.addSubnet(base, prefix, 'ipv6');
}

export function isPrivateAddress(ip: string): boolean {
  const bare = ip.replace(/^\[|\]$/g, '');
  if (net.isIPv4(bare)) return blocked.check(bare, 'ipv4');
  if (net.isIPv6(bare)) return blocked.check(bare, 'ipv6');
  return true;
}

const guardedAgent = new Agent({
  connect: {
    lookup(hostname, options, callback) {
      dns.lookup(hostname, { ...options, all: true }, (err, addresses) => {
        if (err) return callback(err, '', 4);
        const list = Array.isArray(addresses) ? addresses : [{ address: addresses as unknown as string, family: 4 }];
        const blocked = list.find((a) => isPrivateAddress(a.address));
        if (blocked) {
          return callback(new Error(`Refusing to connect to private address ${blocked.address}`), '', 4);
        }
        // undici asked for all addresses when options.all is set; otherwise hand back the first
        if ((options as { all?: boolean }).all) return (callback as unknown as (e: null, a: typeof list) => void)(null, list);
        callback(null, list[0].address, list[0].family);
      });
    },
  },
});

/** Throws a readable error when a custom base URL is not allowed. */
export function assertEndpointAllowed(baseUrl: string): URL {
  let u: URL;
  try {
    u = new URL(baseUrl);
  } catch {
    throw new Error('Enter a full URL, like https://api.example.com/v1');
  }
  if (allowPrivate) {
    if (u.protocol !== 'https:' && u.protocol !== 'http:') throw new Error('The endpoint must be http or https.');
    return u;
  }
  if (u.protocol !== 'https:') throw new Error('The endpoint must use https.');
  const host = u.hostname.replace(/^\[|\]$/g, '').replace(/\.$/, '').toLowerCase();
  if (host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.internal')) {
    throw new Error('Private endpoints are not allowed on this server.');
  }
  // Undici connects to IP literals without a DNS lookup, so the connect-time
  // guard never sees them. Real providers have hostnames anyway.
  if (net.isIP(host)) {
    throw new Error('Use the endpoint\'s hostname, not an IP address.');
  }
  return u;
}

export async function safeFetch(url: string, init: Parameters<typeof undiciFetch>[1] = {}) {
  assertEndpointAllowed(url);
  if (allowPrivate) return undiciFetch(url, init);
  return undiciFetch(url, { ...init, dispatcher: guardedAgent, redirect: 'error' });
}
