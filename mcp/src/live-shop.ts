/**
 * Hangar list gate: HTTPS MCP or hangar store that answers tools / 402 / health.
 * Identity-only cards (DID / GRVR / eip155) are not live shops.
 */
import { assertPublicExtractTarget } from './origin.js';
import type { FetchFn } from './types.js';

export type LiveShop = {
  mcpUrl?: string;
  storeUrl?: string;
  liveAt: string;
};

export type LiveShopCtx = {
  fetch: FetchFn;
  resolveHost: (hostname: string) => Promise<string[]>;
  now: () => Date;
  config: { probeTimeoutMs: number };
};

const MCP_KEYS = new Set(['mcp', 'mcpurl']);
const STORE_KEYS = new Set(['store', 'storeurl', 'hangar', 'shop', 'http', 'extract', 'witness', 'pin']);

export function httpsShopCandidates(card: unknown): { mcp: string[]; store: string[] } {
  const mcp: string[] = [];
  const store: string[] = [];
  if (!card || typeof card !== 'object') return { mcp, store };
  const rec = card as Record<string, unknown>;
  pushHttps(mcp, rec.mcpUrl);
  pushHttps(mcp, rec.mcp);
  pushHttps(store, rec.storeUrl);
  pushHttps(store, rec.store);
  pushHttps(store, rec.url);

  const endpoints = rec.endpoints;
  if (endpoints && typeof endpoints === 'object') {
    for (const [key, value] of Object.entries(endpoints as Record<string, unknown>)) {
      const k = key.toLowerCase();
      if (MCP_KEYS.has(k)) pushHttps(mcp, value);
      else if (STORE_KEYS.has(k) || k === 'url') pushHttps(store, value);
    }
  }

  const services = rec.services;
  if (Array.isArray(services)) {
    for (const svc of services) {
      if (!svc || typeof svc !== 'object') continue;
      const row = svc as { name?: unknown; endpoint?: unknown };
      const name = typeof row.name === 'string' ? row.name.toLowerCase() : '';
      if (MCP_KEYS.has(name) || name.includes('mcp')) pushHttps(mcp, row.endpoint);
      else if (STORE_KEYS.has(name) || /store|hangar|shop|extract|witness|pin/.test(name)) {
        pushHttps(store, row.endpoint);
      } else {
        pushHttps(store, row.endpoint);
      }
    }
  }
  return { mcp: unique(mcp), store: unique(store) };
}

export async function findLiveShop(card: unknown, ctx: LiveShopCtx): Promise<LiveShop | undefined> {
  const { mcp, store } = httpsShopCandidates(card);
  const liveAt = ctx.now().toISOString();
  let mcpUrl: string | undefined;
  let storeUrl: string | undefined;
  for (const url of mcp.slice(0, 3)) {
    if (await probeLiveHttps(url, ctx)) {
      mcpUrl = url;
      break;
    }
  }
  for (const url of store.slice(0, 3)) {
    if (url === mcpUrl) continue;
    if (await probeLiveHttps(url, ctx)) {
      storeUrl = url;
      break;
    }
  }
  if (!mcpUrl && !storeUrl) return undefined;
  return { ...(mcpUrl ? { mcpUrl } : {}), ...(storeUrl ? { storeUrl } : {}), liveAt };
}

export async function probeLiveHttps(raw: string, ctx: LiveShopCtx): Promise<boolean> {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return false;
  }
  if (url.protocol !== 'https:') return false;
  try {
    await assertPublicExtractTarget(url.toString(), ctx.resolveHost);
  } catch {
    return false;
  }
  try {
    const res = await ctx.fetch(url.toString(), {
      method: 'GET',
      redirect: 'follow',
      signal: AbortSignal.timeout(ctx.config.probeTimeoutMs),
    });
    const body = await res.text();
    return isLiveShopResponse(res, body);
  } catch {
    return false;
  }
}

export function isLiveShopResponse(res: Response, body: string): boolean {
  if (res.status === 402) return true;
  const auth = res.headers.get('www-authenticate') ?? '';
  if (res.headers.get('payment-required') || /x402/i.test(auth)) return true;
  if (res.status < 200 || res.status >= 400) return false;
  try {
    const json = JSON.parse(body) as Record<string, unknown>;
    if (json.protocol === 'mcp') return true;
    if (json.status === 'healthy' || json.ok === true) return true;
    if (Array.isArray(json.tools) && json.tools.length > 0) return true;
    const result = json.result;
    if (result && typeof result === 'object') {
      const tools = (result as { tools?: unknown }).tools;
      if (Array.isArray(tools) && tools.length > 0) return true;
    }
  } catch {
    return false;
  }
  return false;
}

function pushHttps(into: string[], raw: unknown): void {
  if (typeof raw !== 'string' || !raw) return;
  try {
    const url = new URL(raw);
    if (url.protocol !== 'https:') return;
    into.push(url.toString());
  } catch {
    /* not a shop URL */
  }
}

function unique(rows: string[]): string[] {
  return [...new Set(rows)];
}
