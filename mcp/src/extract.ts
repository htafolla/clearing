import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { textHash } from './bytes.js';
import { artifactId } from './cache.js';
import { htmlToMarkdown } from './html.js';
import { ClearingError } from './errors.js';
import { assertPublicExtractTarget } from './origin.js';
import { hasNoAiSignal, isPathDisallowed } from './robots.js';
import { buildQuote, buildRequirements, paymentHeaderFromRequest, quoteHeaders } from './x402.js';
import type { ClearingContext } from './context.js';
import type { ExtractResult } from './types.js';

const PUBLIC_DIR = join(dirname(fileURLToPath(import.meta.url)), '../../public');

export async function handleExtract(req: Request, ctx: ClearingContext): Promise<Response> {
  const url = new URL(req.url);
  if (url.pathname === '/health') {
    return json({ ok: true, service: 'clearing-extract' });
  }
  if (url.pathname === '/agents.md' || url.pathname === '/llms.txt') {
    return new Response(publicText(url.pathname), { headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
  }
  if (url.pathname === '/.well-known/agent.json') {
    return json(agentCard(ctx));
  }
  if (url.pathname === '/.well-known/agent-tools-verify.txt') {
    try {
      const body = readFileSync(join(PUBLIC_DIR, '.well-known/agent-tools-verify.txt'), 'utf8');
      return new Response(body, { headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
    } catch {
      return new Response('missing', { status: 404, headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
    }
  }
  if (url.pathname !== '/v1/extract') {
    return json({ error: 'not found' }, 404);
  }

  const targetRaw = url.searchParams.get('url') ?? '';
  const js = url.searchParams.get('js') === '1' || url.searchParams.get('js') === 'true';
  if (!targetRaw) return json({ error: 'url is required' }, 400);
  if (js && !ctx.renderer) {
    return json({ error: 'js rendering is not enabled', blocked: true, reason: 'js_unavailable' }, 400);
  }

  let target: URL;
  try {
    target = await assertPublicExtractTarget(targetRaw, ctx.resolveHost);
  } catch (err) {
    return json({ error: err instanceof Error ? err.message : 'bad url' }, 400);
  }

  const policy = await prepayPolicy(target, js, ctx);
  if (policy.blocked) {
    return json(policy.result, 200);
  }

  const amountUsd = js ? ctx.config.extractPriceJsUsd : ctx.config.extractPriceUsd;
  const resource = url.toString();
  const requirements = buildRequirements({
    amountUsd,
    payTo: ctx.config.payTo,
    resource,
    description: js ? 'Receipted URL extract (js)' : 'Receipted URL extract',
  });
  const quote = buildQuote(requirements);
  const paymentHeader = paymentHeaderFromRequest(req.headers);
  if (!paymentHeader) {
    return new Response(JSON.stringify(quote), { status: 402, headers: quoteHeaders(quote) });
  }

  const settle = await ctx.facilitator.settle(paymentHeader, requirements);
  if (settle.ok) {
    try {
      const payload = (await import('./x402.js')).decodePayload(paymentHeader);
      const from = payload.eip3009?.from ?? ctx.config.payTo;
      ctx.settlements.add({
        from,
        to: ctx.config.payTo,
        amountUsd: String(amountUsd),
        at: ctx.now().toISOString(),
        txHash: (settle.txHash ?? `0x${'00'.repeat(32)}`) as `0x${string}`,
        tag: 'external',
      });
    } catch {
      /* discover can lag one receipt */
    }
  }
  if (!settle.ok) {
    return new Response(JSON.stringify(buildQuote(requirements, settle.error ?? 'payment rejected')), {
      status: 402,
      headers: quoteHeaders(quote),
    });
  }

  const cached = ctx.cache.getByUrl(policy.page.finalUrl);
  const artifact = cached ?? policy.page;
  artifact.paid = true;
  if (settle.txHash) artifact.txHash = settle.txHash;
  if (!cached) ctx.cache.put(artifact);
  artifact.replayed = settle.replayed;
  return json(artifact, 200, {
    'PAYMENT-RESPONSE': settle.txHash ?? '',
    'X-PAYMENT-RESPONSE': settle.txHash ?? '',
  });
}

async function prepayPolicy(
  target: URL,
  js: boolean,
  ctx: ClearingContext,
): Promise<{ blocked: true; result: ExtractResult } | { blocked: false; page: ExtractResult }> {
  const robotsUrl = `${target.origin}/robots.txt`;
  try {
    const robotsRes = await ctx.fetch(robotsUrl, { signal: AbortSignal.timeout(ctx.config.probeTimeoutMs) });
    if (robotsRes.ok) {
      const robotsTxt = await robotsRes.text();
      if (isPathDisallowed(robotsTxt, target.pathname || '/')) {
        return { blocked: true, result: blocked(target, 'robots.txt') };
      }
    }
  } catch {
    return { blocked: true, result: blocked(target, 'robots_timeout') };
  }

  try {
    const page = js && ctx.renderer
      ? { ...(await ctx.renderer(target.toString())), status: 200, headers: new Headers() }
      : await fetchPage(target.toString(), ctx);
    if (page.status === 402) {
      return { blocked: true, result: blocked(target, 'paid-origin', page.finalUrl) };
    }
    if (hasNoAiSignal(page.html, page.headers)) {
      return { blocked: true, result: blocked(target, 'no-ai', page.finalUrl) };
    }
    const { title, markdown } = htmlToMarkdown(page.html, ctx.config.maxChars);
    const fetchedAt = ctx.now().toISOString();
    const bodyBytes = Buffer.byteLength(page.html);
    const result: ExtractResult = {
      url: target.toString(),
      finalUrl: page.finalUrl,
      title,
      markdown,
      textHash: textHash(markdown),
      fetchedAt,
      cacheTtlSec: ctx.config.cacheTtlSec,
      bytes: Buffer.byteLength(markdown),
      blocked: false,
      httpStatus: page.status,
      contentType: page.headers.get('content-type') ?? '',
      bodySha256: textHash(page.html),
      bodyBytes,
    };
    void artifactId(result.finalUrl, result.markdown);
    return { blocked: false, page: result };
  } catch (err) {
    const reason =
      err instanceof ClearingError && err.code === 'ssrf'
        ? 'ssrf'
        : `upstream:${err instanceof Error ? err.message : 'fetch_failed'}`;
    return { blocked: true, result: blocked(target, reason) };
  }
}

async function fetchPage(
  url: string,
  ctx: ClearingContext,
): Promise<{ html: string; finalUrl: string; status: number; headers: Headers }> {
  let current = url;
  for (let hop = 0; hop < 5; hop += 1) {
    await assertPublicExtractTarget(current, ctx.resolveHost);
    const res = await ctx.fetch(current, {
      method: 'GET',
      redirect: 'manual',
      signal: AbortSignal.timeout(ctx.config.fetchTimeoutMs),
      headers: { 'User-Agent': 'ClearingExtract/0.1 (+https://clearing.dev/agents.md)' },
    });
    if (res.status >= 300 && res.status < 400) {
      const location = res.headers.get('location');
      if (!location) {
        const html = await res.text();
        return { html, finalUrl: current, status: res.status, headers: res.headers };
      }
      current = new URL(location, current).toString();
      continue;
    }
    const html = await res.text();
    return { html, finalUrl: res.url || current, status: res.status, headers: res.headers };
  }
  throw new ClearingError('ssrf', 'too many redirects', 400);
}

function blocked(target: URL, reason: string, finalUrl?: string): ExtractResult {
  return {
    url: target.toString(),
    finalUrl: finalUrl ?? target.toString(),
    title: '',
    markdown: '',
    textHash: textHash(''),
    fetchedAt: new Date(0).toISOString(),
    cacheTtlSec: 0,
    bytes: 0,
    blocked: true,
    reason,
    paid: false,
  };
}

function json(body: unknown, status = 200, extraHeaders?: Record<string, string>): Response {
  const headers: Record<string, string> = { 'Content-Type': 'application/json', ...extraHeaders };
  for (const [k, v] of Object.entries(headers)) {
    if (!v) delete headers[k];
  }
  return new Response(JSON.stringify(body), { status, headers });
}

function publicText(pathname: string): string {
  const file = pathname === '/llms.txt' ? 'llms.txt' : 'agents.md';
  try {
    return readFileSync(join(PUBLIC_DIR, file), 'utf8');
  } catch {
    if (pathname === '/llms.txt') {
      return `# Clearing
extract: GET /v1/extract?url={url}&js=0|1
witness: GET /v1/witness?url={url}
pin: GET /v1/pin?agentId={id}
listed: GET /v1/listed
rule: pay pin ($0.01 USDC Base) + live HTTPS MCP or hangar store (tools / 402 / health) → listed. Identity-only cards are not listed. No extra directory fee.
chain: eip155:8453
asset: USDC
retry: same paymentId, never re-sign
`;
    }
    return `# Clearing\nExtract: GET /v1/extract\nChain: Base 8453 USDC\nRetry: same paymentId\n`;
  }
}

function agentCard(ctx: ClearingContext): Record<string, unknown> {
  return {
    name: 'Clearing',
    description: 'Receipted URL extract + ERC-8004 pin. Pay pin → listed. Pay live x402 only.',
    endpoints: {
      http: `${ctx.config.extractBaseUrl}/v1/extract`,
      pin: `${ctx.config.extractBaseUrl}/v1/pin`,
      listed: `${ctx.config.extractBaseUrl}/v1/listed`,
      witness: `${ctx.config.extractBaseUrl}/v1/witness`,
    },
    payment: {
      chainId: ctx.config.chainId,
      asset: ctx.config.usdc,
      payTo: ctx.config.payTo,
      priceUsd: ctx.config.extractPriceUsd,
    },
  };
}

export { agentCard };
