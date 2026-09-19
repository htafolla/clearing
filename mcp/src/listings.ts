/**
 * Unpaid listings check. Four hangar directories + CDP Bazaar probe.
 */
import { CDP_SEARCH_URL } from './cdp-auth.js';
import { bazaarResourceUrl } from './facilitator.js';
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

  const tokenURI =
    typeof (out.erc8004 as { tokenURI?: string })?.tokenURI === 'string'
      ? (out.erc8004 as { tokenURI: string }).tokenURI
      : '';
  const pingShop = await resolveX402Shop(
    [
      ...(hangar?.shops ?? []).map((s) => s.url),
      hangar?.storeUrl,
      ...(await shopsFromCard(tokenURI, ctx.fetch)),
    ],
    ctx.fetch,
  );
  if (pingShop.url) {
    out.ping = { ok: pingShop.status === 402, status: pingShop.status, url: pingShop.url };
  } else {
    out.ping = { ok: false, error: 'no https 402 shop URL' };
  }

  const a2aHost = hangar?.storeUrl || pingShop.url || '';
  if (a2aHost.startsWith('https://') && !a2aHost.includes('railway.app')) {
    const a2a = `${new URL(a2aHost).origin}/.well-known/agent-card.json`;
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
    out.a2a = { ok: false, error: 'no host' };
  }

  const shopListed = pingShop.url ? bazaarResourceUrl(pingShop.url) : undefined;
  out.bazaar = shopListed
    ? await probeCdpBazaar(shopListed, ctx.fetch)
    : { ok: false, indexed: false, note: 'no x402 shop URL to list in Bazaar' };

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
    const want = bazaarResourceUrl(shopUrl) ?? shopUrl;
    const hit = resources.map(resourceUrlOf).find((u) => {
      const listed = bazaarResourceUrl(u) ?? u;
      return listed === want || u.includes(want);
    });
    if (hit) return { ok: true, indexed: true, url: hit, note: `CDP Bazaar indexed ${want}` };
    return {
      ok: false,
      indexed: false,
      note: 'not in CDP Bazaar until ping settles this shop URL through Coinbase (not /v1/ping).',
    };
  } catch {
    return { ok: false, indexed: false, note: 'CDP Bazaar probe failed' };
  }
}

async function resolveX402Shop(
  candidates: Array<string | undefined>,
  fetchFn: FetchFn,
): Promise<{ url?: string; status?: number }> {
  const seen = new Set<string>();
  for (const raw of candidates) {
    if (!raw || !raw.startsWith('https://') || raw.includes('railway.app')) continue;
    if (seen.has(raw)) continue;
    seen.add(raw);
    if (seen.size > 8) break;
    try {
      const res = await fetchFn(raw, {
        method: 'GET',
        redirect: 'manual',
        signal: AbortSignal.timeout(4000),
        headers: { 'User-Agent': 'ClearingListings/0.1' },
      });
      if (res.status === 402) return { url: raw, status: 402 };
    } catch {
      /* next candidate */
    }
  }
  return {};
}

async function shopsFromCard(tokenURI: string, fetchFn: FetchFn): Promise<string[]> {
  if (!tokenURI.startsWith('https://') || tokenURI.includes('railway.app')) return [];
  try {
    const res = await fetchFn(tokenURI, {
      method: 'GET',
      signal: AbortSignal.timeout(4000),
      headers: { 'User-Agent': 'ClearingListings/0.1' },
    });
    if (!res.ok) return [];
    const card = (await res.json()) as {
      endpoints?: { http?: unknown };
      services?: Array<{ name?: unknown; endpoint?: unknown }>;
    };
    const out: string[] = [];
    if (typeof card.endpoints?.http === 'string') out.push(card.endpoints.http);
    for (const svc of card.services ?? []) {
      if (typeof svc.endpoint === 'string' && svc.endpoint.startsWith('https://')) out.push(svc.endpoint);
    }
    return out;
  } catch {
    return [];
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
