/**
 * GET skim: bounded JSON for the next tool call.
 * finalUrl, title, textHash, bytes, links[] (cap 20). Not extract markdown.
 */
import { textHash } from './bytes.js';
import { ClearingError } from './errors.js';
import { parseSkim } from './html.js';
import { assertPublicExtractTarget } from './origin.js';
import { buildQuote, buildRequirements, paymentHeaderFromRequest, quoteHeaders, type BazaarDiscovery } from './x402.js';
import type { ClearingContext } from './context.js';

export const SKIM_USD = 0.01;
export const SKIM_LINK_CAP = 20;

export async function handleSkim(req: Request, ctx: ClearingContext): Promise<Response | undefined> {
  const url = new URL(req.url);
  if (url.pathname !== '/v1/skim' && !url.pathname.startsWith('/v1/skim/')) return undefined;

  const targetRaw = url.searchParams.get('url') ?? '';
  if (!targetRaw) return json({ error: 'url is required' }, 400);

  let target: URL;
  try {
    target = await assertPublicExtractTarget(targetRaw, ctx.resolveHost);
  } catch (err) {
    return json({ error: err instanceof Error ? err.message : 'bad url' }, 400);
  }

  let page: { finalUrl: string; status: number; contentType: string; body: string };
  try {
    page = await getOnce(target.toString(), ctx);
  } catch (err) {
    const msg = err instanceof ClearingError ? err.message : err instanceof Error ? err.message : 'fetch_failed';
    return json({ error: msg, paid: false }, 400);
  }

  const resource = url.toString();
  const requirements = buildRequirements({
    amountUsd: SKIM_USD,
    payTo: ctx.config.payTo,
    resource,
    description: 'GET skim (title, hash, bytes, links)',
  });
  const quote = buildQuote(requirements, undefined, skimDiscovery(target));
  const paymentHeader = paymentHeaderFromRequest(req.headers);
  if (!paymentHeader) {
    return new Response(JSON.stringify(quote), { status: 402, headers: quoteHeaders(quote) });
  }
  const settle = await ctx.facilitator.settle(paymentHeader, requirements);
  if (!settle.ok) {
    return json({ error: settle.error ?? 'payment not settled', paid: false }, 402);
  }

  const skim = parseSkim(page.body, page.finalUrl, SKIM_LINK_CAP);
  return json({
    paid: true,
    replayed: settle.replayed,
    url: target.toString(),
    finalUrl: page.finalUrl,
    httpStatus: page.status,
    title: skim.title,
    textHash: textHash(page.body),
    bytes: Buffer.byteLength(page.body),
    links: skim.links,
    fetchedAt: ctx.now().toISOString(),
    txHash: settle.txHash,
  }, 200);
}

async function getOnce(
  start: string,
  ctx: ClearingContext,
): Promise<{ finalUrl: string; status: number; contentType: string; body: string }> {
  let current = start;
  for (let hop = 0; hop < 5; hop += 1) {
    await assertPublicExtractTarget(current, ctx.resolveHost);
    const res = await ctx.fetch(current, {
      method: 'GET',
      redirect: 'manual',
      signal: AbortSignal.timeout(ctx.config.fetchTimeoutMs),
      headers: { 'User-Agent': 'ClearingSkim/0.1' },
    });
    if (res.status >= 300 && res.status < 400) {
      const location = res.headers.get('location');
      if (!location) break;
      current = new URL(location, current).toString();
      continue;
    }
    const body = await res.text();
    return {
      finalUrl: current,
      status: res.status,
      contentType: res.headers.get('content-type') ?? '',
      body,
    };
  }
  throw new ClearingError('redirects', 'too many redirects');
}

function skimDiscovery(target: URL): BazaarDiscovery {
  return {
    queryParams: { url: target.toString() },
    querySchema: { url: { type: 'string', description: 'https URL to skim' } },
    requiredQuery: ['url'],
    outputExample: {
      paid: true,
      finalUrl: 'https://example.com/',
      title: 'Example',
      textHash: 'sha256:…',
      bytes: 1200,
      links: ['https://example.com/next'],
    },
    tags: ['skim'],
  };
}

function json(body: unknown, status: number, headers?: Record<string, string>): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...headers },
  });
}
