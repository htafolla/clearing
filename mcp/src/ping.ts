/**
 * Paid ping $0.01. SYN on the target shop is still unpaid GET → 402.
 * Their penny is the yellow-pages soak when Clearing settles through CDP.
 */
import { advertisedOrigin, RIPPEL_CLEARING } from './origin.js';
import { buildCatalog, catalogShopUrls } from './listed.js';
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
  if (one) {
    if (!one.startsWith('https://') || one.includes('railway.app')) {
      return json({ error: 'https public shop URL only (no railway.app)' }, 400);
    }
    targets = [one];
  } else {
    const catalog = await buildCatalog(ctx, url);
    targets = catalogShopUrls(catalog)
      .filter((u) => !u.includes('railway.app') && !u.includes('/v1/ping'))
      .slice(0, 24);
  }

  const resource = url.toString();
  const requirements = buildRequirements({
    amountUsd: PING_USD,
    payTo: ctx.config.payTo,
    resource,
    description: 'Ping shop (live = 402). Penny indexes Bazaar if CDP settles.',
  });
  const quote = buildQuote(requirements, undefined, pingDiscovery(one));
  const paymentHeader = paymentHeaderFromRequest(req.headers);
  if (!paymentHeader) {
    return new Response(JSON.stringify(quote), { status: 402, headers: quoteHeaders(quote) });
  }
  const settle = await ctx.facilitator.settle(paymentHeader, requirements);
  if (!settle.ok) {
    return json({ error: settle.error ?? 'payment not settled', paid: false }, 402);
  }

  const pings: PingRow[] = [];
  for (const target of targets) {
    pings.push(await pingShop(target, ctx));
  }
  const origin = advertisedOrigin(url) || RIPPEL_CLEARING;
  const cdp = Boolean(process.env.CDP_API_KEY_ID && process.env.CDP_API_KEY_SECRET);
  return json({
    paid: true,
    catalog: `${origin}/v1/catalog`,
    syn: 'target unpaid GET, live = 402',
    pings,
    live: pings.filter((p) => p.live).length,
    n: pings.length,
    txHash: settle.txHash,
    bazaar: cdp
      ? 'this settle can index CDP Bazaar if facilitator is CDP'
      : 'ZigZag settle — not in CDP Bazaar. Same penny lists there once CDP keys settle ping.',
  }, 200);
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

function pingDiscovery(one: string): BazaarDiscovery {
  return {
    queryParams: one ? { url: one } : {},
    querySchema: { url: { type: 'string', description: 'https shop URL to ping' } },
    requiredQuery: [],
    outputExample: {
      paid: true,
      pings: [{ url: 'https://clearing.rippel.ai/v1/skim?url=https://example.com', status: 402, live: true }],
    },
    tags: ['ping'],
  };
}

function json(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}
