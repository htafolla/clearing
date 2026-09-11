/**
 * GET witness: proof of a fetch. Not a summary.
 * finalUrl, httpStatus, contentType, bodySha256, bodyBytes. $0.02 USDC.
 */
import { textHash } from './bytes.js';
import { ClearingError } from './errors.js';
import { assertPublicExtractTarget } from './origin.js';
import { buildQuote, buildRequirements, paymentHeaderFromRequest, quoteHeaders } from './x402.js';
import type { ClearingContext } from './context.js';

const WITNESS_USD = 0.02;

export async function handleWitness(req: Request, ctx: ClearingContext): Promise<Response | undefined> {
  const url = new URL(req.url);
  if (url.pathname !== '/v1/witness' && !url.pathname.startsWith('/v1/witness/')) return undefined;

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
    amountUsd: WITNESS_USD,
    payTo: ctx.config.payTo,
    resource,
    description: 'GET witness (status, type, sha256, bytes)',
  });
  const quote = buildQuote(requirements);
  const paymentHeader = paymentHeaderFromRequest(req.headers);
  if (!paymentHeader) {
    return new Response(JSON.stringify(quote), { status: 402, headers: quoteHeaders(quote) });
  }
  const settle = await ctx.facilitator.settle(paymentHeader, requirements);
  if (!settle.ok) {
    return json({ error: settle.error ?? 'payment not settled', paid: false }, 402);
  }

  return json({
    paid: true,
    replayed: settle.replayed,
    url: target.toString(),
    finalUrl: page.finalUrl,
    httpStatus: page.status,
    contentType: page.contentType,
    bodySha256: textHash(page.body),
    bodyBytes: Buffer.byteLength(page.body),
    fetchedAt: ctx.now().toISOString(),
    txHash: settle.txHash,
  });
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
      headers: { 'User-Agent': 'ClearingWitness/0.1' },
    });
    if (res.status >= 300 && res.status < 400) {
      const location = res.headers.get('location');
      if (!location) {
        const body = await res.text();
        return {
          finalUrl: current,
          status: res.status,
          contentType: res.headers.get('content-type') ?? '',
          body,
        };
      }
      current = new URL(location, current).toString();
      continue;
    }
    const body = await res.text();
    return {
      finalUrl: res.url || current,
      status: res.status,
      contentType: res.headers.get('content-type') ?? '',
      body,
    };
  }
  throw new ClearingError('ssrf', 'too many redirects', 400);
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}
