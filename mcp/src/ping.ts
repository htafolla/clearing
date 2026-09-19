/**
 * Paid ping $0.01. SYN on the target shop is unpaid GET → 402.
 * CDP settle indexes that shop URL in Bazaar — never /v1/ping.
 */
import { hasCdpKeys } from './cdp-auth.js';
import { bazaarResourceUrl, pingFacilitator } from './facilitator.js';
import { advertisedOrigin, RIPPEL_CLEARING } from './origin.js';
import { buildCatalog, catalogShopUrls, shopIdFromUrl } from './listed.js';
import { buildQuote, buildRequirements, paymentHeaderFromRequest, quoteHeaders, type BazaarDiscovery } from './x402.js';
import type { ClearingContext } from './context.js';

export const PING_USD = 0.01;
export type PingRow = { url: string; status: number; live: boolean };

export async function handlePing(req: Request, ctx: ClearingContext): Promise<Response | undefined> {
  const url = new URL(req.url);
  if (url.pathname !== '/v1/ping' && !url.pathname.startsWith('/v1/ping/')) return undefined;
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    return json({ error: 'GET only' }, 405);
  }

  const one = (url.searchParams.get('url') ?? '').trim();
  let targets: string[] = [];
  let catalogUrl: string | undefined;
  if (one) {
    if (!one.startsWith('https://') || one.includes('railway.app')) {
      return json({ error: 'https public shop URL only (no railway.app)' }, 400);
    }
    catalogUrl = bazaarResourceUrl(one);
    if (!catalogUrl) {
      return json({ error: 'Bazaar lists the shop URL (402), not /v1/ping or MCP-only hosts' }, 400);
    }
    targets = [one];
  } else {
    const catalog = await buildCatalog(ctx, url);
    targets = catalogShopUrls(catalog)
      .filter((u) => !u.includes('railway.app') && !u.includes('/v1/ping'))
      .slice(0, 24);
  }

  const resource = catalogUrl ?? pingShopUrl(url);
  const requirements = buildRequirements({
    amountUsd: PING_USD,
    payTo: ctx.config.payTo,
    resource,
    description: catalogUrl
      ? 'x402 shop. Unpaid GET returns 402.'
      : 'Catalog ping sweep. Not a Bazaar listing.',
  });
  const quote = buildQuote(requirements, undefined, pingDiscovery(one, catalogUrl));
  const paymentHeader = paymentHeaderFromRequest(req.headers);
  if (!paymentHeader) {
    return new Response(JSON.stringify(quote), { status: 402, headers: quoteHeaders(quote) });
  }

  let syn: PingRow | undefined;
  if (one) syn = await pingShop(one, ctx);
  const indexShop = Boolean(catalogUrl && syn?.live && hasCdpKeys());
  const settle = await pingFacilitator(ctx.facilitator, ctx.fetch, indexShop).settle(
    paymentHeader,
    requirements,
  );
  if (!settle.ok) {
    return json({ error: settle.error ?? 'payment not settled', paid: false }, 402);
  }

  const pings: PingRow[] = [];
  if (syn) {
    pings.push(syn);
  } else {
    for (const target of targets) {
      pings.push(await pingShop(target, ctx));
    }
  }
  const origin = advertisedOrigin(url) || RIPPEL_CLEARING;
  return json({
    paid: true,
    catalog: `${origin}/v1/catalog`,
    syn: 'target unpaid GET, live = 402',
    pings,
    live: pings.filter((p) => p.live).length,
    n: pings.length,
    txHash: settle.txHash,
    facilitator: indexShop ? 'cdp' : 'zigzag',
    bazaar: bazaarNote(indexShop, catalogUrl, syn?.live === true),
  }, 200);
}

export function pingShopUrl(reqUrl: URL): string {
  return `${advertisedOrigin(reqUrl) || RIPPEL_CLEARING}/v1/ping`;
}

async function pingShop(target: string, ctx: ClearingContext): Promise<PingRow> {
  try {
    const res = await ctx.fetch(target, {
      method: 'GET',
      redirect: 'manual',
      signal: AbortSignal.timeout(4000),
      headers: { 'User-Agent': 'ClearingPing/0.1' },
    });
    return { url: target, status: res.status, live: res.status === 402 };
  } catch {
    return { url: target, status: 0, live: false };
  }
}

function bazaarNote(indexShop: boolean, catalogUrl: string | undefined, live: boolean): string {
  if (indexShop && catalogUrl) {
    return `CDP settle of ${catalogUrl} — Bazaar indexes this shop (can lag hours)`;
  }
  if (catalogUrl && !live) {
    return 'target is not 402 — not a Bazaar shop (MCP 200 does not list)';
  }
  return 'ZigZag settle — not in CDP Bazaar. Ping a 402 shop URL to list it.';
}

function pingDiscovery(one: string, catalogUrl: string | undefined): BazaarDiscovery {
  if (!one || !catalogUrl) {
    return {
      queryParams: {},
      querySchema: { url: { type: 'string', description: 'https x402 shop URL (unpaid GET = 402)' } },
      requiredQuery: [],
      outputExample: { paid: true, pings: [{ url: 'https://clearing.rippel.ai/v1/skim', status: 402, live: true }] },
      tags: ['ping'],
    };
  }
  const queryParams: Record<string, string> = {};
  const querySchema: Record<string, { type: 'string' }> = {};
  try {
    const u = new URL(one);
    for (const [k, v] of u.searchParams) {
      queryParams[k] = v;
      querySchema[k] = { type: 'string' };
    }
  } catch {
    /* shop URL already validated */
  }
  return {
    queryParams,
    querySchema,
    requiredQuery: [],
    outputExample: { live: true, status: 402 },
    tags: ['hangar'],
    serviceName: shopIdFromUrl(catalogUrl),
  };
}

function json(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}
