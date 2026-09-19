import { isIP } from 'node:net';
import { ALWAYS_ALLOW_ORIGIN } from './types.js';
import { fail } from './errors.js';

/** Public hangar hostname. Never advertise railway.app. */
export const RIPPEL_CLEARING = 'https://clearing.rippel.ai';

export function advertisedOrigin(reqUrl?: URL): string {
  const env = (process.env.CLEARING_PUBLIC_ORIGIN || '').trim().replace(/\/$/, '');
  if (env) return env;
  const host = (reqUrl?.host || '').toLowerCase();
  if (host && !host.includes('railway.app') && host !== 'localhost' && !host.startsWith('127.')) {
    return `${reqUrl!.protocol}//${reqUrl!.host}`.replace(/\/$/, '');
  }
  if (host.includes('railway.app')) return RIPPEL_CLEARING;
  if (reqUrl?.host) return `${reqUrl.protocol}//${reqUrl.host}`.replace(/\/$/, '');
  return RIPPEL_CLEARING;
}

export function parseHttpUrl(raw: string): URL {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    fail('bad_url', `invalid url: ${raw}`);
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    fail('bad_url', `only http(s) urls are allowed: ${raw}`);
  }
  return url;
}

export function isPrivateHost(hostname: string): boolean {
  const host = hostname.replace(/^\[/, '').replace(/\]$/, '').toLowerCase();
  if (host === 'localhost' || host.endsWith('.localhost') || host === '::1') return true;
  if (host.endsWith('.local') || host === '0.0.0.0') return true;
  const ip = isIP(host) ? host : '';
  if (!ip) return false;
  if (ip.includes(':')) {
    return ip === '::1' || ip.startsWith('fc') || ip.startsWith('fd') || ip.startsWith('fe80');
  }
  const parts = ip.split('.').map(Number);
  const a = parts[0] ?? 0;
  const b = parts[1] ?? 0;
  if (a === 10 || a === 127 || a === 0) return true;
  if (a === 169 && b === 254) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 168) return true;
  return false;
}

export function assertPublicExtractUrl(raw: string): URL {
  const url = parseHttpUrl(raw);
  if (isPrivateHost(url.hostname)) {
    fail('ssrf', `refusing private extract target ${url.hostname}`);
  }
  return url;
}

export async function assertPublicExtractTarget(
  raw: string,
  resolveHost: (hostname: string) => Promise<string[]>,
): Promise<URL> {
  const url = assertPublicExtractUrl(raw);
  let addrs: string[];
  try {
    addrs = await resolveHost(url.hostname);
  } catch {
    fail('ssrf', `unresolvable extract target ${url.hostname}`);
  }
  for (const addr of addrs) {
    if (isPrivateHost(addr)) {
      fail('ssrf', `refusing private extract IP ${addr}`);
    }
  }
  return url;
}

export function originAllowed(url: URL, allowOrigins: string[], discoverLive: Set<string>): boolean {
  const host = url.hostname.toLowerCase();
  const hostPort = url.host.toLowerCase();
  if (host === ALWAYS_ALLOW_ORIGIN || hostPort === ALWAYS_ALLOW_ORIGIN) return true;
  for (const entry of allowOrigins) {
    const e = entry.toLowerCase();
    if (e === host || e === hostPort) return true;
  }
  if (discoverLive.has(host) || discoverLive.has(hostPort) || discoverLive.has(url.origin.toLowerCase())) {
    return true;
  }
  return false;
}

export function originOf(raw: string): string {
  return parseHttpUrl(raw).origin;
}
