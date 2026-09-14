/**
 * 8004-pin: pay $0.01 USDC to pin a live ERC-8004 identity card.
 * Successful settle lists the agent on GET /v1/listed|/v1/online only if the card
 * is Groover certified, Dynamo solar PASS/citation, and has a live HTTPS MCP or
 * hangar store (tools / 402 / health). Online = health ok within probeIntervalMs
 * (default 15 minutes). Identity-only is not listed.
 * Returns owner, agentURI, card JSON, sha256 of the bytes. Due diligence, not a scrape.
 */
import { createHash } from 'node:crypto';
import { ClearingError } from './errors.js';
import { assertPublicExtractTarget } from './origin.js';
import { IDENTITY_REGISTRY } from './types.js';
import { hangarCertified } from './gates.js';
import { findLiveShop, type LiveShop } from './live-shop.js';
import { buildQuote, buildRequirements, decodePayload, paymentHeaderFromRequest, quoteHeaders } from './x402.js';
import type { ClearingContext } from './context.js';

const PIN_USD = 0.01;
const TRANSFER_OWNER = '0x6352211e';
const TOKEN_URI = '0xc87b56dd';

export async function handlePin(req: Request, ctx: ClearingContext): Promise<Response | undefined> {
  const url = new URL(req.url);
  if (url.pathname !== '/v1/pin' && !url.pathname.startsWith('/v1/pin/')) return undefined;

  const agentIdRaw = url.searchParams.get('agentId') ?? url.pathname.split('/').pop() ?? '';
  const agentId = Number.parseInt(agentIdRaw, 10);
  if (!Number.isInteger(agentId) || agentId < 0) {
    return json({ error: 'agentId is required (uint)' }, 400);
  }
  const registry = (url.searchParams.get('registry') ?? IDENTITY_REGISTRY).toLowerCase();
  if (!registry.startsWith('0x') || registry.length !== 42) {
    return json({ error: 'registry must be a 20-byte address' }, 400);
  }

  let owner: string;
  try {
    owner = await ownerOf(ctx, registry, agentId);
  } catch (err) {
    return json({ error: err instanceof Error ? err.message : 'agent not found', agentId }, 404);
  }

  let agentURI: string;
  let fetched: { card: unknown; sha256: string; bytes: number };
  try {
    agentURI = await tokenUri(ctx, registry, agentId);
    fetched = await fetchCard(ctx, agentURI);
  } catch (err) {
    const msg =
      err instanceof ClearingError ? err.message : err instanceof Error ? err.message : 'card_fetch_failed';
    const status = err instanceof ClearingError ? err.httpStatus : 400;
    return json({ error: msg, paid: false }, status);
  }

  const resource = url.toString();
  const requirements = buildRequirements({
    amountUsd: PIN_USD,
    payTo: ctx.config.payTo,
    resource,
    description: `ERC-8004 pin agentId ${agentId}`,
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

  const live = await findLiveShop(fetched.card, ctx);
  const certified = hangarCertified(fetched.card);
  const listable = Boolean(live && certified);
  if (live && certified) noteListed(ctx, agentId, paymentHeader, settle.txHash, live, certified);

  return json({
    paid: true,
    listed: listable,
    chainId: 8453,
    registry,
    agentId,
    owner,
    agentURI,
    card: fetched.card,
    sha256: fetched.sha256,
    bytes: fetched.bytes,
    txHash: settle.txHash,
    ...(live?.mcpUrl ? { mcpUrl: live.mcpUrl } : {}),
    ...(live?.storeUrl ? { storeUrl: live.storeUrl } : {}),
    ...(certified ? { groover: certified.groover, solar: certified.solar } : {}),
  });
}

async function ownerOf(ctx: ClearingContext, registry: string, agentId: number): Promise<string> {
  const data = TRANSFER_OWNER + agentId.toString(16).padStart(64, '0');
  const result = await ethCall(ctx, registry, data);
  if (!result || result === '0x' || /^0x0+$/.test(result)) {
    throw new Error(`no owner for agentId ${agentId}`);
  }
  return `0x${result.slice(-40)}`;
}

async function tokenUri(ctx: ClearingContext, registry: string, agentId: number): Promise<string> {
  const data = TOKEN_URI + agentId.toString(16).padStart(64, '0');
  const result = await ethCall(ctx, registry, data);
  return decodeAbiString(result);
}

async function ethCall(ctx: ClearingContext, to: string, data: string): Promise<string> {
  const rpcs = [
    process.env.CLEARING_RPC_URL?.trim(),
    'https://mainnet.base.org',
    'https://1rpc.io/base',
  ].filter((u): u is string => Boolean(u));
  let last = 'no rpc';
  for (const rpc of rpcs) {
    try {
      const res = await ctx.fetch(rpc, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 1,
          method: 'eth_call',
          params: [{ to, data }, 'latest'],
        }),
        signal: AbortSignal.timeout(ctx.config.fetchTimeoutMs),
      });
      const body = (await res.json()) as { result?: string; error?: { message?: string } };
      if (body.result && body.result !== '0x') return body.result;
      last = body.error?.message ?? `empty result ${rpc}`;
    } catch (err) {
      last = err instanceof Error ? err.message : String(err);
    }
  }
  throw new Error(last);
}

function decodeAbiString(hex: string): string {
  const h = hex.startsWith('0x') ? hex.slice(2) : hex;
  if (h.length < 128) return '';
  const offset = Number.parseInt(h.slice(0, 64), 16);
  const start = offset * 2;
  const len = Number.parseInt(h.slice(start, start + 64), 16);
  if (!Number.isFinite(len) || len < 0 || len > 10_000) return '';
  return Buffer.from(h.slice(start + 64, start + 64 + len * 2), 'hex').toString('utf8');
}

async function fetchCard(
  ctx: ClearingContext,
  agentURI: string,
): Promise<{ card: unknown; sha256: string; bytes: number }> {
  if (!agentURI.startsWith('http://') && !agentURI.startsWith('https://') && !agentURI.startsWith('ipfs://')) {
    const sha256 = createHash('sha256').update(agentURI).digest('hex');
    return { card: { raw: agentURI }, sha256, bytes: Buffer.byteLength(agentURI) };
  }
  const url = agentURI.startsWith('ipfs://')
    ? `https://ipfs.io/ipfs/${agentURI.slice('ipfs://'.length)}`
    : agentURI;
  await assertPublicExtractTarget(url, ctx.resolveHost);
  const res = await ctx.fetch(url, { signal: AbortSignal.timeout(ctx.config.fetchTimeoutMs) });
  const buf = Buffer.from(await res.arrayBuffer());
  const sha256 = createHash('sha256').update(buf).digest('hex');
  let card: unknown = buf.toString('utf8');
  try {
    card = JSON.parse(buf.toString('utf8')) as unknown;
  } catch {
    /* keep text */
  }
  return { card, sha256, bytes: buf.length };
}

function noteListed(
  ctx: ClearingContext,
  agentId: number,
  paymentHeader: string,
  tx: `0x${string}` | undefined,
  live: LiveShop,
  certified: { groover: string; solar: string },
): void {
  let paymentId = '';
  try {
    paymentId = decodePayload(paymentHeader).paymentId;
  } catch {
    paymentId = '';
  }
  if (!paymentId) paymentId = tx ? `tx:${tx}` : `pin:${agentId}:${ctx.now().toISOString()}`;
  ctx.listed.add({
    agentId,
    paymentId,
    pinnedAt: ctx.now().toISOString(),
    ...(tx ? { tx } : {}),
    ...(live.mcpUrl ? { mcpUrl: live.mcpUrl } : {}),
    ...(live.storeUrl ? { storeUrl: live.storeUrl } : {}),
    liveAt: live.liveAt,
    groover: certified.groover,
    solar: certified.solar,
    healthAt: live.liveAt,
  });
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}
