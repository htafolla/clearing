/**
 * Unpaid listings check. Four hangar directories + CDP Bazaar probe.
 */
import { CDP_SEARCH_URL } from './cdp-auth.js';
import { IDENTITY_REGISTRY, type FetchFn } from './types.js';
import { advertisedOrigin, RIPPEL_CLEARING } from './origin.js';
import { buildCatalog } from './listed.js';
import { ownerOf, tokenUri } from './pin.js';
import type { ClearingContext } from './context.js';

export async function handleListings(req: Request, ctx: ClearingContext): Promise<Response | undefined> {
  const url = new URL(req.url);
  if (url.pathname !== '/v1/listings' && !url.pathname.startsWith('/v1/listings/')) return undefined;
  const agentId = Number.parseInt(url.searchParams.get('agentId') ?? '', 10);
  if (!Number.isInteger(agentId) || agentId < 0) {
    return json({ error: 'agentId required' }, 400);
  }

  const origin = advertisedOrigin(url) || RIPPEL_CLEARING;
  const out: Record<string, unknown> = {
    agentId,
    directories: 4,
    yellowPages: 'cdp-bazaar',
  };

  try {
    const owner = await ownerOf(ctx, IDENTITY_REGISTRY, agentId);
    const uri = await tokenUri(ctx, IDENTITY_REGISTRY, agentId);
    out.erc8004 = { ok: true, owner, tokenURI: uri };
  } catch (err) {
    out.erc8004 = { ok: false, error: err instanceof Error ? err.message : 'not on 8004' };
  }

  const catalog = await buildCatalog(ctx, url);
  const hangar = catalog.hangars.find((h) => h.agentId === agentId);
  out.catalog = hangar
    ? { ok: true, shops: hangar.shops }
    : { ok: false, catalog: `${origin}/v1/catalog` };

  const shopUrl =
    hangar?.shops?.[0]?.url ||
    (typeof (out.erc8004 as { tokenURI?: string })?.tokenURI === 'string'
      ? (out.erc8004 as { tokenURI: string }).tokenURI
      : '');
  if (shopUrl.startsWith('https://') && !shopUrl.includes('railway.app')) {
    try {
      const res = await ctx.fetch(shopUrl, {
        method: 'GET',
        redirect: 'manual',
        signal: AbortSignal.timeout(4000),
        headers: { 'User-Agent': 'ClearingListings/0.1' },
      });
      out.ping = { ok: res.status === 402, status: res.status, url: shopUrl };
    } catch {
      out.ping = { ok: false, status: 0, url: shopUrl };
    }
    const a2a = shopUrl.includes('/v1/')
      ? `${new URL(shopUrl).origin}/.well-known/agent-card.json`
      : shopUrl;
    try {
      const res = await ctx.fetch(a2a, {
        method: 'GET',
        signal: AbortSignal.timeout(4000),
        headers: { 'User-Agent': 'ClearingListings/0.1' },
      });
      const text = await res.text();
      const jsonOk = res.status === 200 && text.trim().startsWith('{');
      out.a2a = { ok: jsonOk, status: res.status, url: a2a };
    } catch {
      out.a2a = { ok: false, url: a2a };
    }
  } else {
    out.ping = { ok: false, error: 'no https shop URL' };
    out.a2a = { ok: false, error: 'no host' };
  }

  out.bazaar = await probeCdpBazaar(`${origin}/v1/ping`, ctx.fetch);

  return json(out, 200);
}

export async function probeCdpBazaar(
  shopUrl: string,
  fetchFn: FetchFn,
): Promise<{ ok: boolean; indexed: boolean; note: string; url?: string }> {
  try {
    const res = await fetchFn(`${CDP_SEARCH_URL}?query=${encodeURIComponent(shopUrl)}&limit=20`, {
      method: 'GET',
      signal: AbortSignal.timeout(4000),
      headers: { 'User-Agent': 'ClearingListings/0.1' },
    });
    if (!res.ok) {
      return { ok: false, indexed: false, note: `CDP Bazaar search ${res.status}` };
    }
    const body = (await res.json()) as { resources?: unknown[] };
    const resources = Array.isArray(body.resources) ? body.resources : [];
    const hit = resources
      .map(resourceUrlOf)
      .find((u) => u.includes('clearing.rippel.ai/v1/ping'));
    if (hit) return { ok: true, indexed: true, url: hit, note: 'CDP Bazaar indexed /v1/ping' };
    return {
      ok: false,
      indexed: false,
      note: 'not in CDP Bazaar until ping settles through Coinbase (not ZigZag). Same nonce once.',
    };
  } catch {
    return { ok: false, indexed: false, note: 'CDP Bazaar probe failed' };
  }
}

function resourceUrlOf(row: unknown): string {
  if (!row || typeof row !== 'object') return '';
  const resource = (row as { resource?: unknown }).resource;
  if (typeof resource === 'string') return resource;
  if (resource && typeof resource === 'object' && typeof (resource as { url?: unknown }).url === 'string') {
    return (resource as { url: string }).url;
  }
  return '';
}

function json(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}
