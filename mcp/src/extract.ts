import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { textHash } from './bytes.js';
import { artifactId } from './cache.js';
import { htmlToMarkdown } from './html.js';
import { ClearingError } from './errors.js';
import { assertPublicExtractTarget } from './origin.js';
import { hasNoAiSignal, isPathDisallowed } from './robots.js';
import { buildQuote, buildRequirements, paymentHeaderFromRequest, quoteHeaders, type BazaarDiscovery } from './x402.js';
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
    return agentToolsVerifyTxt(url);
  }
  if (url.pathname === '/.well-known/x402') {
    return json(x402WellKnown(url));
  }
  if (url.pathname === '/openapi.json') {
    return json(openapiDoc(url));
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
  const description = js ? 'Receipted URL extract (js)' : 'Receipted URL extract';
  const requirements = buildRequirements({
    amountUsd,
    payTo: ctx.config.payTo,
    resource,
    description,
  });
  const discovery = extractDiscovery(target, js);
  const quote = buildQuote(requirements, undefined, discovery);
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
    return new Response(JSON.stringify(buildQuote(requirements, settle.error ?? 'payment rejected', discovery)), {
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

function extractDiscovery(target: URL, js: boolean): BazaarDiscovery {
  return {
    queryParams: { url: target.toString(), js: js ? '1' : '0' },
    querySchema: {
      url: { type: 'string', description: 'Public https URL to extract' },
      js: { type: 'string', description: 'Set 1 for JS-rendered extract (0.05 USDC)' },
    },
    requiredQuery: ['url'],
    outputExample: {
      url: target.toString(),
      title: 'Example Domain',
      markdown: '# Example Domain',
      textHash: 'sha256:00',
      blocked: false,
      httpStatus: 200,
    },
    tags: ['extract'],
  };
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

const RIPPEL_VERIFY_TOKEN = 'atc_ahATpKU6I8yhcD0aIdaKZp3ONf0bjyj9';
const RAILWAY_VERIFY_TOKEN = 'atc_r6O9K2gBe1-IuHPkirXKsiJ4TQSYNIkx';
const X402_DESCRIPTOR_TOKEN = 'atc_rnW0Dzjm-5VcJzsY7wGmYtjr1jtncK69';

/** Host-aware ATC file claim. Do not overwrite the rippel.ai token in public/.well-known/agent-tools-verify.txt. */
function agentToolsVerifyTxt(url: URL): Response {
  const host = (url.host || '').toLowerCase();
  const headers = { 'Content-Type': 'text/plain; charset=utf-8' };
  if (host.includes('railway.app')) {
    const railwayToken = process.env.AGENT_TOOLS_VERIFY_TOKEN_RAILWAY?.trim() || RAILWAY_VERIFY_TOKEN;
    return new Response(railwayToken, { headers });
  }
  try {
    const body = readFileSync(join(PUBLIC_DIR, '.well-known/agent-tools-verify.txt'), 'utf8');
    return new Response(body, { headers });
  } catch {
    return new Response(RIPPEL_VERIFY_TOKEN, { headers });
  }
}

/**
 * GET /.well-known/x402 — ATC descriptor claim.
 * Override with CLEARING_AGENT_TOOLS_VERIFY or AGENT_TOOLS_VERIFY_DESCRIPTOR.
 * Do not reuse AGENT_TOOLS_VERIFY_TOKEN_RAILWAY (that is the verify.txt railway claim).
 */
function x402WellKnown(reqUrl: URL): Record<string, unknown> {
  let body: Record<string, unknown> = { agentToolsVerify: X402_DESCRIPTOR_TOKEN };
  try {
    const raw = readFileSync(join(PUBLIC_DIR, '.well-known/x402'), 'utf8');
    const parsed = JSON.parse(raw) as unknown;
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      body = { ...body, ...(parsed as Record<string, unknown>) };
    }
  } catch {
    /* default token */
  }
  const token = (
    process.env.CLEARING_AGENT_TOOLS_VERIFY ||
    process.env.AGENT_TOOLS_VERIFY_DESCRIPTOR ||
    ''
  ).trim();
  if (token) body.agentToolsVerify = token;
  const origin = `${reqUrl.protocol}//${reqUrl.host}`;
  if (body.x402Version === undefined) body.x402Version = 2;
  if (body.resources === undefined) {
    body.resources = [
      `${origin}/v1/extract?url=https://example.com`,
      `${origin}/v1/witness?url=https://example.com`,
      `${origin}/v1/pin`,
    ];
  }
  return body;
}

/** Cheap x402scan OpenAPI breadcrumb. Runtime 402 is authoritative. */
function openapiDoc(reqUrl: URL): Record<string, unknown> {
  const origin = `${reqUrl.protocol}//${reqUrl.host}`;
  const paid = (description: string, amount: string) => ({
    description,
    parameters: [] as unknown[],
    responses: {
      '200': { description: 'Paid success' },
      '402': { description: 'Payment required' },
    },
    'x-payment-info': {
      price: { mode: 'fixed', currency: 'USD', amount },
      protocols: [{ x402: {} }],
    },
  });
  return {
    openapi: '3.1.0',
    info: {
      title: 'Clearing',
      version: '0.1.0',
      description: 'Receipted URL extract, GET witness, and ERC-8004 pin. Pay live x402 only.',
    },
    servers: [{ url: origin }],
    paths: {
      '/v1/extract': {
        get: {
          ...paid('Receipted URL extract', '0.020000'),
          parameters: [
            { name: 'url', in: 'query', required: true, schema: { type: 'string' } },
            { name: 'js', in: 'query', required: false, schema: { type: 'string' } },
          ],
        },
      },
      '/v1/witness': {
        get: {
          ...paid('GET witness (status, type, sha256, bytes)', '0.020000'),
          parameters: [{ name: 'url', in: 'query', required: true, schema: { type: 'string' } }],
        },
      },
      '/v1/pin': {
        get: {
          ...paid('ERC-8004 pin', '0.010000'),
          parameters: [
            { name: 'agentId', in: 'query', required: true, schema: { type: 'string' } },
            { name: 'registry', in: 'query', required: false, schema: { type: 'string' } },
          ],
        },
      },
    },
  };
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
online: GET /v1/online
rule: pin ($0.01 USDC Base) + Groover (DID/GRVR) + Dynamo solar (PASS or citation) + live HTTPS MCP or hangar store + online (health ok within 15 min) → listed. Pin alone is not enough. Identity-only cards are not listed. No extra directory fee.
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
      online: `${ctx.config.extractBaseUrl}/v1/online`,
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
