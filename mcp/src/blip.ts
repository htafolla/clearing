/**
 * Hangar skill `blip` — Clearing shop half of the factory pair.
 * Route: GET|POST /v1/blip
 * Factory: plant `blip` on xray 4.0.15 / d466f1a91 (kapow opt live).
 *
 * x402 quote BEFORE work. Failed gen → no charge.
 * ZigZag-shaped EIP-3009 honesty (`signer:zigzag`) — not marketplace, not hosted /sign.
 * Escalator LOCKED: price¢ = max(5, round(5 + 550 * (mintIndex/555)**2))
 * Pay settle gates Base Blips ERC-721 mint to the payer wallet.
 */
import { isHexAddress, normalizeAddress } from './bytes.js';
import { ClearingError } from './errors.js';
import {
  BLIPS_ESCALATOR_FORMULA,
  BLIPS_ESCALATOR_KIND,
  blipPriceCents,
  blipPriceUsd,
} from './blips-escalator.js';
import { parseBlipPicture } from './blips-picture.js';
import {
  archivePlantVideo,
  copyBlipMedia,
  hangarMediaUrl,
  hangarPosterUrl,
  parseMediaMintIndex,
  parsePosterMintIndex,
  posterSvg,
  readBlipMedia,
  mediaFileResponse,
} from './blips-media.js';
import { FileBlipsStore } from './blips-store.js';
import { BLIP_DURATION_SEC, BLIP_PLANT_VERSION } from './blips-plant.js';
import {
  buildQuote,
  buildRequirements,
  decodePayload,
  paymentHeaderFromRequest,
  quoteHeaders,
  requirementsMatch,
} from './x402.js';
import type { ClearingContext } from './context.js';
import type { HexAddress, PayloadBody, PaymentRequirements } from './types.js';

const TOTAL_SUPPLY_SEL = '0x18160ddd';
const BALANCE_OF_SEL = '0x70a08231';
const TOKEN_OF_OWNER_BY_INDEX_SEL = '0x2f745c59';
const TOKEN_URI_SEL = '0xc87b56dd';
const OWNER_OF_SEL = '0x6352211e';
const MAX_OWNED_ENUMERATE = 555;

export async function handleBlip(req: Request, ctx: ClearingContext): Promise<Response | undefined> {
  const url = new URL(req.url);
  if (!url.pathname.startsWith('/v1/blip')) return undefined;

  if (url.pathname === '/v1/blip/owned' || url.pathname.startsWith('/v1/blip/owned/')) {
    return owned(url, ctx);
  }
  if (url.pathname.startsWith('/v1/blip/metadata/')) {
    return metadata(url, ctx);
  }
  if (url.pathname.startsWith('/v1/blip/media/')) {
    return media(url, req, ctx);
  }
  if (url.pathname.startsWith('/v1/blip/poster/')) {
    return poster(url, ctx);
  }
  if (url.pathname === '/v1/blip/migrate' || url.pathname === '/v1/blip/migrate/') {
    return migrate(req, ctx);
  }
  if (url.pathname !== '/v1/blip' && url.pathname !== '/v1/blip/') {
    return json({ error: 'not found' }, 404);
  }

  const input = await readInput(req, url);
  const picture = parseBlipPicture(input.picture);
  if (!picture.ok) {
    return json({ error: picture.reason, paid: false }, 400);
  }
  if (!input.brief.trim()) {
    return json({ error: 'brief is required', paid: false }, 400);
  }

  const mintIndex = await nextMintIndex(ctx);
  const priceCents = blipPriceCents(mintIndex);
  const amountUsd = blipPriceUsd(mintIndex);
  const resource = blipResource(url, picture.picture, input.brief);
  const requirements = buildRequirements({
    amountUsd,
    payTo: ctx.config.payTo,
    resource,
    description: `Blip ${picture.picture} mintIndex ${mintIndex} · ${priceCents}¢ · ${BLIPS_ESCALATOR_FORMULA}`,
    extra: {
      signer: 'zigzag',
      skill: 'blip',
      mintIndex,
      priceCents,
      escalator: BLIPS_ESCALATOR_KIND,
      formula: BLIPS_ESCALATOR_FORMULA,
      priceFinal: true,
      mintIndexSource: 'settledPaid',
    },
  });
  const quote = buildQuote(
    requirements,
    `X-PAYMENT required · Blips escalator LOCKED · ${priceCents}¢ at mintIndex ${mintIndex} · ${BLIPS_ESCALATOR_FORMULA}`,
  );

  const paymentHeader = paymentHeaderFromRequest(req.headers);
  if (!paymentHeader) {
    return new Response(JSON.stringify(quote), { status: 402, headers: quoteHeaders(quote) });
  }

  let payload: PayloadBody;
  try {
    payload = decodePayload(paymentHeader);
  } catch (err) {
    return json({ error: err instanceof Error ? err.message : 'bad payment', paid: false }, 402);
  }
  if (!requirementsMatch(payload, requirements)) {
    return json({ error: 'payload does not match quote', paid: false }, 402);
  }

  const ownerWallet = ownerFrom(payload, input.owner);
  if (!ownerWallet) {
    return json({ error: 'ownerWallet required (eip3009.from or owner=)', paid: false }, 400);
  }

  let plant;
  try {
    plant = await ctx.blipPlant.render({
      picture: picture.picture,
      brief: input.brief,
      style: input.style,
      mintIndex,
    });
  } catch (err) {
    const msg = err instanceof ClearingError ? err.message : err instanceof Error ? err.message : 'plant failed';
    return json({ error: msg, paid: false, charged: false }, 502);
  }
  if (!plant.ok) {
    return json(
      {
        error: plant.reason ?? 'plant FAIL',
        paid: false,
        charged: false,
        picture: picture.picture,
        plantVersion: plant.plantVersion,
      },
      502,
    );
  }

  let videoUrl = plant.videoUrl;
  if (ctx.blips instanceof FileBlipsStore) {
    videoUrl = await archivePlantVideo({
      videoUrl: plant.videoUrl,
      dataDir: ctx.config.dataDir,
      mintIndex,
      publicBase: ctx.config.extractBaseUrl,
      fetchFn: ctx.fetch,
      nft: ctx.config.blipsNft,
    });
  }

  const settle = await ctx.facilitator.settle(paymentHeader, requirements);
  if (!settle.ok) {
    return json({ error: settle.error ?? 'payment not settled', paid: false, charged: false }, 402);
  }

  const tokenURI = `${ctx.config.extractBaseUrl.replace(/\/$/, '')}/v1/blip/metadata/${mintIndex}`;
  let minted;
  try {
    minted = await ctx.blipsMinter.mint({
      ownerWallet,
      tokenURI,
      mintIndex,
    });
  } catch (err) {
    return json(
      {
        error: err instanceof Error ? err.message : 'nft mint failed',
        paid: true,
        charged: true,
        txHash: settle.txHash,
        videoUrl,
        note: 'payment settled; NFT mint failed — not a soft-DB ownership substitute',
      },
      502,
    );
  }

  ctx.blips.add({
    mintIndex,
    tokenId: minted.tokenId,
    ownerWallet: minted.ownerWallet,
    mintTx: minted.mintTx,
    paymentId: payload.paymentId,
    payTx: settle.txHash,
    priceCents,
    picture: picture.picture,
    brief: input.brief,
    videoUrl,
    imageUrl: plant.imageUrl || hangarPosterUrl(ctx.config.extractBaseUrl, mintIndex),
    audioUrl: plant.audioUrl,
    durationSec: plant.durationSec || BLIP_DURATION_SEC,
    plantVersion: plant.plantVersion || BLIP_PLANT_VERSION,
    tokenURI,
    settledAt: ctx.now().toISOString(),
  });

  try {
    ctx.settlements.add({
      from: ownerWallet,
      to: ctx.config.payTo,
      amountUsd: String(amountUsd),
      at: ctx.now().toISOString(),
      txHash: (settle.txHash ?? minted.mintTx) as HexAddress,
      tag: 'external',
    });
  } catch {
    /* discover can lag */
  }

  return json(
    {
      paid: true,
      replayed: settle.replayed,
      skill: 'blip',
      picture: picture.picture,
      brief: input.brief,
      videoUrl,
      imageUrl: plant.imageUrl,
      audioUrl: plant.audioUrl,
      durationSec: plant.durationSec || BLIP_DURATION_SEC,
      mintIndex,
      'price¢': priceCents,
      priceCents,
      plantVersion: plant.plantVersion || BLIP_PLANT_VERSION,
      ownerWallet: minted.ownerWallet,
      tokenId: minted.tokenId,
      mintTx: minted.mintTx,
      tokenURI,
      txHash: settle.txHash,
      paymentId: payload.paymentId,
      escalator: BLIPS_ESCALATOR_KIND,
      formula: BLIPS_ESCALATOR_FORMULA,
      mintIndexSource: 'settledPaid',
      chainId: 8453,
      collection: 'Blips',
      market: false,
    },
    200,
    {
      'PAYMENT-RESPONSE': settle.txHash ?? '',
      'X-PAYMENT-RESPONSE': settle.txHash ?? '',
    },
  );
}

async function nextMintIndex(ctx: ClearingContext): Promise<number> {
  const settled = ctx.blips.count();
  let supply = 0;
  try {
    supply = await ctx.blipsMinter.totalSupply();
  } catch {
    supply = 0;
  }
  const chain = await chainTotalSupply(ctx);
  return Math.max(settled, supply, chain ?? 0);
}

async function chainTotalSupply(ctx: ClearingContext): Promise<number | undefined> {
  const nft = ctx.config.blipsNft;
  if (!nft) return undefined;
  const raw = await ethCall(ctx, nft, TOTAL_SUPPLY_SEL);
  if (!raw) return undefined;
  return Number(BigInt(raw));
}

type ChainOwned = { tokenId: number; ownerWallet: HexAddress; tokenURI: string };

/** Enumerate Blips ERC-721 via eth_call. undefined = no collection / RPC miss (fall back to minter). */
async function chainTokensOf(ctx: ClearingContext, owner: HexAddress): Promise<ChainOwned[] | undefined> {
  const nft = ctx.config.blipsNft;
  if (!nft) return undefined;
  const balanceRaw = await ethCall(ctx, nft, `${BALANCE_OF_SEL}${padAddress(owner)}`);
  if (!balanceRaw) return undefined;
  const balance = Number(BigInt(balanceRaw));
  if (!Number.isFinite(balance) || balance <= 0) return [];
  const n = Math.min(balance, MAX_OWNED_ENUMERATE);
  const out: ChainOwned[] = [];
  for (let i = 0; i < n; i += 1) {
    const idRaw = await ethCall(ctx, nft, `${TOKEN_OF_OWNER_BY_INDEX_SEL}${padAddress(owner)}${padUint(i)}`);
    if (!idRaw) continue;
    const tokenId = Number(BigInt(idRaw));
    if (!Number.isFinite(tokenId) || tokenId < 0) continue;
    const [uriRaw, ownerRaw] = await Promise.all([
      ethCall(ctx, nft, `${TOKEN_URI_SEL}${padUint(tokenId)}`),
      ethCall(ctx, nft, `${OWNER_OF_SEL}${padUint(tokenId)}`),
    ]);
    const onchainOwner = ownerRaw ? addressFromWord(ownerRaw) : undefined;
    if (onchainOwner && onchainOwner !== owner) continue;
    out.push({
      tokenId,
      ownerWallet: onchainOwner ?? owner,
      tokenURI: uriRaw ? decodeAbiString(uriRaw) : '',
    });
  }
  return out;
}

async function ethCall(ctx: ClearingContext, to: HexAddress, data: string): Promise<string | undefined> {
  const rpcs = [process.env.CLEARING_RPC_URL?.trim(), 'https://mainnet.base.org', 'https://1rpc.io/base'].filter(
    (u): u is string => Boolean(u),
  );
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
        signal: AbortSignal.timeout(ctx.config.probeTimeoutMs),
      });
      const body = (await res.json()) as { result?: string };
      if (body.result && body.result !== '0x') return body.result;
    } catch {
      /* next rpc */
    }
  }
  return undefined;
}

function padAddress(addr: HexAddress): string {
  return addr.slice(2).toLowerCase().padStart(64, '0');
}

function padUint(n: number): string {
  return n.toString(16).padStart(64, '0');
}

function addressFromWord(word: string): HexAddress | undefined {
  const raw = `0x${word.slice(-40)}`;
  return isHexAddress(raw) ? normalizeAddress(raw) : undefined;
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

function ownerFrom(payload: PayloadBody, owner?: string): HexAddress | undefined {
  const from = payload.eip3009?.from ?? owner;
  if (!from || !isHexAddress(from)) return undefined;
  return normalizeAddress(from);
}

function blipResource(url: URL, picture: string, brief: string): string {
  const u = new URL(url.toString());
  u.searchParams.set('picture', picture);
  u.searchParams.set('brief', brief);
  u.hash = '';
  return u.toString();
}

async function readInput(
  req: Request,
  url: URL,
): Promise<{ picture: string; brief: string; style?: string; owner?: string }> {
  let body: Record<string, unknown> = {};
  if (req.method === 'POST' || req.method === 'PUT') {
    const text = await req.text();
    if (text) {
      try {
        body = JSON.parse(text) as Record<string, unknown>;
      } catch {
        body = {};
      }
    }
  }
  const picture = String(url.searchParams.get('picture') ?? body.picture ?? '');
  const brief = String(url.searchParams.get('brief') ?? body.brief ?? body.cue ?? '');
  const styleRaw = url.searchParams.get('style') ?? body.style;
  const ownerRaw = url.searchParams.get('owner') ?? body.owner ?? body.ownerWallet;
  return {
    picture,
    brief,
    ...(typeof styleRaw === 'string' && styleRaw ? { style: styleRaw } : {}),
    ...(typeof ownerRaw === 'string' && ownerRaw ? { owner: ownerRaw } : {}),
  };
}

async function owned(url: URL, ctx: ClearingContext): Promise<Response> {
  const wallet = url.searchParams.get('wallet') ?? url.searchParams.get('owner') ?? '';
  if (!isHexAddress(wallet)) return json({ error: 'wallet is required' }, 400);
  const owner = normalizeAddress(wallet);

  let minterTokens: Awaited<ReturnType<typeof ctx.blipsMinter.tokensOf>> = [];
  try {
    minterTokens = await ctx.blipsMinter.tokensOf(owner);
  } catch {
    minterTokens = [];
  }
  const minterById = new Map(minterTokens.map((t) => [t.tokenId, t]));

  const chainTokens = await chainTokensOf(ctx, owner);
  const source = chainTokens ? 'chain' : 'chain-minter';
  const ids = chainTokens ?? minterTokens.map((t) => ({
    tokenId: t.tokenId,
    ownerWallet: t.ownerWallet,
    tokenURI: t.tokenURI,
  }));

  const rows = ids.map((t) => {
    const receipt = ctx.blips.get(t.tokenId);
    const minter = minterById.get(t.tokenId);
    const mintTx = receipt?.mintTx ?? minter?.mintTx;
    const tokenURI = t.tokenURI || receipt?.tokenURI || minter?.tokenURI || '';
    return {
      tokenId: t.tokenId,
      ownerWallet: t.ownerWallet || receipt?.ownerWallet || minter?.ownerWallet || owner,
      mintTx,
      tokenURI,
      mintIndex: receipt?.mintIndex ?? minter?.mintIndex ?? t.tokenId,
      basescan: mintTx
        ? `https://basescan.org/tx/${mintTx}`
        : ctx.config.blipsNft
          ? `https://basescan.org/nft/${ctx.config.blipsNft}/${t.tokenId}`
          : undefined,
      picture: receipt?.picture,
      videoUrl: receipt?.videoUrl,
      imageUrl: receipt?.imageUrl,
      audioUrl: receipt?.audioUrl,
      priceCents: receipt?.priceCents,
      durationSec: receipt?.durationSec ?? BLIP_DURATION_SEC,
    };
  });
  return json({
    wallet: owner,
    source,
    market: false,
    tokens: rows,
  });
}

function operatorAuthorized(req: Request): boolean {
  const token = (process.env.CLEARING_OPERATOR_TOKEN || process.env.CLEARING_RAIL_TOKEN || '').trim();
  if (!token) return false;
  return (req.headers.get('authorization') || '') === `Bearer ${token}`;
}

async function migrate(req: Request, ctx: ClearingContext): Promise<Response> {
  if (req.method !== 'POST') return json({ error: 'POST' }, 405);
  if (!operatorAuthorized(req)) return json({ error: 'unauthorized' }, 401);
  let body: {
    tokenId?: number;
    picture?: string;
    brief?: string;
    ownerWallet?: string;
    aliasOf?: number;
    force?: boolean;
  };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return json({ error: 'invalid json' }, 400);
  }
  const tokenId = Number(body.tokenId);
  if (!Number.isInteger(tokenId) || tokenId < 0) return json({ error: 'tokenId' }, 400);
  const rawPic = String(body.picture || 'still').trim();
  const pictureIn =
    rawPic === 'still' || rawPic.startsWith('motion:') ? rawPic : `motion:${rawPic}`;
  const parsed = parseBlipPicture(pictureIn);
  if (!parsed.ok) return json({ error: parsed.reason }, 400);
  const brief =
    String(body.brief || '').trim() ||
    'Cyan arc over a gold nameplate. Factory floor at shift change.';
  const base = ctx.config.extractBaseUrl.replace(/\/$/, '');
  let videoUrl: string | undefined;
  const existing = readBlipMedia(ctx.config.dataDir, tokenId, ctx.config.blipsNft);
  if (existing && !body.force) {
    videoUrl = hangarMediaUrl(base, tokenId);
  } else if (typeof body.aliasOf === 'number') {
    if (copyBlipMedia(ctx.config.dataDir, body.aliasOf, tokenId, ctx.config.blipsNft)) {
      videoUrl = hangarMediaUrl(base, tokenId);
    } else {
      videoUrl = hangarMediaUrl(base, body.aliasOf);
    }
  } else {
    const plant = await ctx.blipPlant.render({ picture: parsed.picture, brief });
    if (!plant.ok) {
      return json({ error: plant.reason ?? 'plant FAIL', tokenId }, 502);
    }
    videoUrl = await archivePlantVideo({
      videoUrl: plant.videoUrl,
      dataDir: ctx.config.dataDir,
      mintIndex: tokenId,
      publicBase: base,
      fetchFn: ctx.fetch,
      nft: ctx.config.blipsNft,
    });
  }
  const ownerWallet =
    body.ownerWallet && isHexAddress(body.ownerWallet)
      ? normalizeAddress(body.ownerWallet)
      : ('0x0000000000000000000000000000000000000000' as HexAddress);
  ctx.blips.upsert({
    mintIndex: tokenId,
    tokenId,
    ownerWallet,
    mintTx: `0x${'0'.repeat(64)}` as HexAddress,
    paymentId: `migrate:${tokenId}`,
    priceCents: blipPriceCents(tokenId),
    picture: parsed.picture,
    brief,
    videoUrl,
    imageUrl: hangarPosterUrl(base, tokenId),
    durationSec: BLIP_DURATION_SEC,
    plantVersion: `remaster:${BLIP_PLANT_VERSION}`,
    tokenURI: `${base}/v1/blip/metadata/${tokenId}`,
    settledAt: ctx.now().toISOString(),
  });
  return json({ ok: true, tokenId, picture: parsed.picture, videoUrl, remaster: true });
}

function poster(url: URL, ctx: ClearingContext): Response {
  const mintIndex = parsePosterMintIndex(url.pathname);
  if (mintIndex === undefined) return json({ error: 'tokenId' }, 400);
  const receipt = ctx.blips.get(mintIndex);
  const svg = posterSvg(mintIndex, receipt?.picture ?? 'still');
  return new Response(svg, {
    status: 200,
    headers: {
      'Content-Type': 'image/svg+xml; charset=utf-8',
      'Cache-Control': 'public, max-age=86400',
      'Access-Control-Allow-Origin': '*',
    },
  });
}

function media(url: URL, req: Request, ctx: ClearingContext): Response {
  const mintIndex = parseMediaMintIndex(url.pathname);
  if (mintIndex === undefined) return json({ error: 'tokenId' }, 400);
  const buf = readBlipMedia(ctx.config.dataDir, mintIndex, ctx.config.blipsNft);
  if (!buf) return json({ error: 'missing' }, 404);
  return mediaFileResponse(buf, req.headers.get('range'));
}

async function metadata(url: URL, ctx: ClearingContext): Promise<Response> {
  const idRaw = url.pathname.split('/').pop() ?? '';
  const tokenId = Number.parseInt(idRaw, 10);
  if (!Number.isInteger(tokenId) || tokenId < 0) return json({ error: 'tokenId' }, 400);
  const receipt = ctx.blips.get(tokenId);
  const minted = await ctx.blipsMinter.get(tokenId);
  if (!receipt && !minted) return json({ error: 'unknown token' }, 404);
  const picture = receipt?.picture ?? 'still';
  const media = receipt?.videoUrl ?? receipt?.imageUrl;
  const base = ctx.config.extractBaseUrl.replace(/\/$/, '');
  const poster = receipt?.imageUrl || hangarPosterUrl(base, tokenId);
  return json({
    name: `Blip #${tokenId}`,
    description: `4.44s shortie that blips · ${picture}`,
    animation_url: receipt?.videoUrl,
    image: poster,
    audio: receipt?.audioUrl,
    external_url: minted?.tokenURI ?? receipt?.tokenURI,
    attributes: [
      { trait_type: 'picture', value: picture },
      { trait_type: 'mintIndex', value: receipt?.mintIndex ?? tokenId },
      { trait_type: 'priceCents', value: receipt?.priceCents ?? blipPriceCents(tokenId) },
      { trait_type: 'durationSec', value: receipt?.durationSec ?? BLIP_DURATION_SEC },
      { trait_type: 'plantVersion', value: receipt?.plantVersion ?? BLIP_PLANT_VERSION },
      { trait_type: 'escalator', value: BLIPS_ESCALATOR_KIND },
    ],
    receipt: {
      ownerWallet: receipt?.ownerWallet ?? minted?.ownerWallet,
      mintTx: receipt?.mintTx ?? minted?.mintTx,
      payTx: receipt?.payTx,
      brief: receipt?.brief,
      media,
    },
  });
}

function json(body: unknown, status = 200, extra?: Record<string, string>): Response {
  const headers: Record<string, string> = { 'Content-Type': 'application/json', ...extra };
  for (const [k, v] of Object.entries(headers)) {
    if (!v) delete headers[k];
  }
  return new Response(JSON.stringify(body), { status, headers });
}

export type { PaymentRequirements };
