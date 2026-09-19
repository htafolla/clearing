/**
 * Unpaid find/ping. SYN = GET shop, live = HTTP 402.
 * Catalog is the hosts file. Not a 402 shop.
 */
import { advertisedOrigin, RIPPEL_CLEARING } from './origin.js';
import { buildCatalog, catalogShopUrls } from './listed.js';
import type { ClearingContext } from './context.js';

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
      return json({ error: 'https rippel/public shop URL only' }, 400);
    }
    targets = [one];
  } else {
    const catalog = await buildCatalog(ctx, url);
    targets = catalogShopUrls(catalog).filter((u) => !u.includes('railway.app')).slice(0, 24);
  }

  const pings: PingRow[] = [];
  for (const target of targets) {
    pings.push(await pingShop(target, ctx));
  }
  const origin = advertisedOrigin(url) || RIPPEL_CLEARING;
  return json({
    catalog: `${origin}/v1/catalog`,
    syn: 'unpaid GET, live = 402',
    pings,
    live: pings.filter((p) => p.live).length,
    n: pings.length,
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

function json(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}
