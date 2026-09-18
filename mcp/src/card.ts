/**
 * Gasless ERC-8004 card mill. Agent pays USDC; hangar pays ETH and transfers the token.
 * POST JSON card (hosted here) or GET ?uri=. Nickel.
 */
import { assertPublicExtractTarget } from './origin.js';
import { IDENTITY_REGISTRY, type HexAddress } from './types.js';
import { isHexAddress, normalizeAddress } from './bytes.js';
import {
  buildQuote,
  buildRequirements,
  decodePayload,
  paymentHeaderFromRequest,
  quoteHeaders,
  type BazaarDiscovery,
} from './x402.js';
import type { ClearingContext } from './context.js';

export const CARD_USD = 0.05;

export async function handleCard(req: Request, ctx: ClearingContext): Promise<Response | undefined> {
  const url = new URL(req.url);
  const hosted = url.pathname.match(/^\/v1\/card\/([a-zA-Z0-9-]+)\.json$/);
  if (hosted) {
    const row = ctx.cards.get(hosted[1] ?? '');
    if (!row) return json({ error: 'card not found' }, 404);
    return new Response(JSON.stringify(row.json), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  }
  if (url.pathname === '/v1/locker') return handleLocker(req, ctx);
  if (url.pathname !== '/v1/card' && !url.pathname.startsWith('/v1/card/')) return undefined;

  if (!ctx.cardRegistrar.ready()) {
    return json({ error: 'card mill off — set CLEARING_8004_KEY' }, 503);
  }

  let pendingCard: unknown;
  let agentURI = (url.searchParams.get('uri') ?? '').trim();
  if (req.method === 'POST') {
    const raw = await req.text();
    if (raw.length > 32_000) return json({ error: 'card too large' }, 400);
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw) as unknown;
    } catch {
      return json({ error: 'JSON card required' }, 400);
    }
    const card = unwrapCard(parsed);
    if (!card || typeof card !== 'object' || Array.isArray(card)) {
      return json({ error: 'card object required' }, 400);
    }
    pendingCard = card;
  } else if (agentURI) {
    try {
      await assertPublicExtractTarget(agentURI, ctx.resolveHost);
    } catch (err) {
      return json({ error: err instanceof Error ? err.message : 'bad uri' }, 400);
    }
  } else {
    return json({ error: 'POST JSON card or GET ?uri=' }, 400);
  }

  const resource = url.toString();
  const requirements = buildRequirements({
    amountUsd: CARD_USD,
    payTo: ctx.config.payTo,
    resource,
    description: 'ERC-8004 card mill (hangar pays gas)',
  });
  const quote = buildQuote(requirements, undefined, cardDiscovery());
  const paymentHeader = paymentHeaderFromRequest(req.headers);
  if (!paymentHeader) {
    return new Response(JSON.stringify(quote), { status: 402, headers: quoteHeaders(quote) });
  }
  const settle = await ctx.facilitator.settle(paymentHeader, requirements);
  if (!settle.ok) {
    return json({ error: settle.error ?? 'payment not settled', paid: false }, 402);
  }

  let from: HexAddress | undefined;
  try {
    const payload = decodePayload(paymentHeader);
    const raw = payload.eip3009?.from ?? url.searchParams.get('owner') ?? '';
    if (isHexAddress(raw)) from = normalizeAddress(raw);
  } catch {
    from = undefined;
  }
  if (!from) {
    return json({ error: 'eip3009.from required (paying wallet)', paid: true }, 400);
  }

  let hostedId: string | undefined;
  if (pendingCard !== undefined) {
    const row = ctx.cards.put(pendingCard, from);
    hostedId = row.id;
    agentURI = cardPublicUri(ctx, url, row.id);
  }

  let minted;
  try {
    minted = await ctx.cardRegistrar.register(agentURI, from);
  } catch (err) {
    return json(
      {
        error: err instanceof Error ? err.message : 'register failed',
        paid: true,
      },
      502,
    );
  }
  if (hostedId) ctx.cards.attachAgent(hostedId, minted.agentId);
  const pin = `${originOf(url, ctx)}/v1/pin?agentId=${minted.agentId}`;
  return json({
    paid: true,
    registry: IDENTITY_REGISTRY,
    chainId: 8453,
    agentId: minted.agentId,
    agentURI: minted.agentURI,
    owner: minted.owner,
    txHash: minted.txHash,
    transferred: minted.transferred,
    pin,
    next: minted.transferred
      ? 'GET pin URL with same x402 envelope ($0.01) to list'
      : 'Token minted; transfer to payer pending. Pin still lists. GET pin URL ($0.01).',
  }, 200);
}

export async function handleLocker(req: Request, ctx: ClearingContext): Promise<Response> {
  const url = new URL(req.url);
  const fromRaw = url.searchParams.get('from') ?? '';
  if (!isHexAddress(fromRaw)) return json({ error: 'from=0x wallet required' }, 400);
  const from = normalizeAddress(fromRaw);
  const cards = ctx.cards.listFrom(from);
  let blips: unknown[] = [];
  try {
    blips = await ctx.blipsMinter.tokensOf(from);
  } catch {
    blips = [];
  }
  return json({ from, cards, blips }, 200);
}

function unwrapCard(parsed: unknown): unknown {
  if (parsed && typeof parsed === 'object' && !Array.isArray(parsed) && 'card' in parsed) {
    return (parsed as { card: unknown }).card;
  }
  return parsed;
}

function cardPublicUri(ctx: ClearingContext, reqUrl: URL, id: string): string {
  const base = (ctx.config.extractBaseUrl || `${reqUrl.protocol}//${reqUrl.host}`).replace(/\/$/, '');
  return `${base}/v1/card/${id}.json`;
}

function originOf(reqUrl: URL, ctx: ClearingContext): string {
  if (reqUrl.host) return `${reqUrl.protocol}//${reqUrl.host}`;
  return ctx.config.extractBaseUrl.replace(/\/$/, '');
}

function cardDiscovery(): BazaarDiscovery {
  return {
    queryParams: { uri: 'https://example.com/8004.json' },
    querySchema: {
      uri: { type: 'string', description: 'HTTPS shops card URI (or POST JSON)' },
      owner: { type: 'string', description: 'Paying wallet (or eip3009.from)' },
    },
    requiredQuery: [],
    outputExample: {
      paid: true,
      agentId: 1,
      agentURI: 'https://example.com/8004.json',
      pin: 'https://clearing.rippel.ai/v1/pin?agentId=1',
    },
    tags: ['card', '8004'],
  };
}

function json(body: unknown, status: number, headers?: Record<string, string>): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...headers },
  });
}
