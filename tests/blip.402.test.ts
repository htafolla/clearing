import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { handleBlip } from '../mcp/src/blip.js';
import { handleHangar } from '../mcp/src/http.js';
import { handleTool } from '../mcp/src/tools.js';
import { FakeBlipPlant, millCardFromReceipt } from '../mcp/src/blips-plant.js';
import { MemoryBlipsMinter } from '../mcp/src/blips-nft.js';
import { blipPriceCents } from '../mcp/src/blips-escalator.js';
import { MemoryFacilitator } from '../mcp/src/facilitator.js';
import { encodePayload, V2_REQUIRED_HEADER } from '../mcp/src/x402.js';
import { assertBaseUsdcEip712, makeCtx, PAYER_A } from './helpers.js';

function uintWord(n: number): string {
  return `0x${n.toString(16).padStart(64, '0')}`;
}

function addrWord(addr: string): string {
  return `0x${addr.slice(2).toLowerCase().padStart(64, '0')}`;
}

function abiString(value: string): string {
  const hex = Buffer.from(value, 'utf8').toString('hex');
  const len = (hex.length / 2).toString(16).padStart(64, '0');
  const padded = hex.padEnd(Math.ceil(hex.length / 64) * 64, '0');
  return `0x${(32).toString(16).padStart(64, '0')}${len}${padded}`;
}

function blipUrl(picture = 'still', brief = 'night alley still', owner = PAYER_A): string {
  const q = new URLSearchParams({ picture, brief, owner });
  return `https://api.clearing.dev/v1/blip?${q.toString()}`;
}

async function pay(reqUrl: string, ctx: ReturnType<typeof makeCtx>, extra?: RequestInit): Promise<Response> {
  const unpaid = await handleBlip(new Request(reqUrl), ctx);
  expect(unpaid?.status).toBe(402);
  const quote = (await unpaid!.json()) as {
    accepts: Array<import('../mcp/src/types.js').PaymentRequirements>;
  };
  const header = encodePayload({
    x402Version: 1,
    paymentId: randomUUID(),
    nonce: randomUUID(),
    accepted: quote.accepts[0]!,
    eip3009: {
      from: PAYER_A,
      to: ctx.config.payTo,
      value: quote.accepts[0]!.maxAmountRequired,
      validAfter: '0',
      validBefore: '9999999999',
      nonce: `0x${'11'.repeat(32)}`,
      signature: `0x${'22'.repeat(65)}`,
    },
  });
  return handleBlip(
    new Request(reqUrl, { headers: { 'X-PAYMENT': header, ...(extra?.headers ?? {}) } }),
    ctx,
  ) as Promise<Response>;
}

describe('hangar skill blip', () => {
  it('unpaid call → 402 with LOCKED quadratic ¢ (not HOLD, not flat)', async () => {
    const ctx = makeCtx();
    const res = await handleBlip(new Request(blipUrl()), ctx);
    expect(res?.status).toBe(402);
    const body = (await res!.json()) as {
      error: string;
      accepts: Array<{
        maxAmountRequired: string;
        network: string;
        extra: {
          name: string;
          version: string;
          signer: string;
          formula: string;
          priceCents: number;
          mintIndex: number;
          priceFinal: boolean;
        };
      }>;
    };
    expect(body.accepts[0]?.network).toBe('eip155:8453');
    expect(body.accepts[0]?.maxAmountRequired).toBe('50000');
    assertBaseUsdcEip712(body.accepts[0]?.extra);
    expect(body.accepts[0]?.extra.signer).toBe('zigzag');
    expect(body.accepts[0]?.extra.priceCents).toBe(5);
    expect(body.accepts[0]?.extra.mintIndex).toBe(0);
    expect(body.accepts[0]?.extra.priceFinal).toBe(true);
    expect(body.accepts[0]?.extra.formula).toContain('(mintIndex/555)**2');
    expect(body.error).toMatch(/LOCKED/);
    expect(body.error).not.toMatch(/HOLD/);
    expect(res?.headers.get(V2_REQUIRED_HEADER)).toBeTruthy();
    expect((ctx.facilitator as MemoryFacilitator).debitCount()).toBe(0);
    expect(ctx.blipPlant).toBeInstanceOf(FakeBlipPlant);
    expect((ctx.blipPlant as FakeBlipPlant).calls).toBe(0);
  });

  it('paid settle → artifacts + receipt + NFT to payer wallet', async () => {
    const ctx = makeCtx();
    const res = await pay(blipUrl(), ctx);
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      paid: boolean;
      videoUrl: string;
      audioUrl: string;
      durationSec: number;
      picture: string;
      mintIndex: number;
      priceCents: number;
      ownerWallet: string;
      tokenId: number;
      mintTx: string;
      plantVersion: string;
      market: boolean;
    };
    expect(body.paid).toBe(true);
    expect(body.picture).toBe('still');
    expect(body.durationSec).toBe(4.44);
    expect(body.videoUrl).toMatch(/\.mp4$/);
    expect(body.audioUrl).toMatch(/\.wav$/);
    expect(body.mintIndex).toBe(0);
    expect(body.priceCents).toBe(5);
    expect(body.ownerWallet).toBe(PAYER_A);
    expect(body.tokenId).toBe(0);
    expect(body.mintTx).toMatch(/^0x[a-f0-9]{64}$/);
    expect(body.plantVersion).toBeTruthy();
    expect(body.market).toBe(false);
    expect((ctx.facilitator as MemoryFacilitator).debitCount()).toBe(1);
    expect(ctx.blips.count()).toBe(1);
    expect(await ctx.blipsMinter.totalSupply()).toBe(1);
  });

  it('unknown motion FAIL before quote (no charge); kapow and destination are live opts', async () => {
    const ctx = makeCtx();
    const unknown = await handleBlip(new Request(blipUrl('kenburns')), ctx);
    expect(unknown?.status).toBe(400);
    const kapow = await handleBlip(new Request(blipUrl('motion:kapow')), ctx);
    expect(kapow?.status).toBe(402);
    const destination = await handleBlip(new Request(blipUrl('motion:destination')), ctx);
    expect(destination?.status).toBe(402);
    expect((ctx.facilitator as MemoryFacilitator).debitCount()).toBe(0);
  });

  it('same paymentId does not mill or mint twice', async () => {
    const ctx = makeCtx();
    const unpaid = await handleBlip(new Request(blipUrl()), ctx);
    const quote = (await unpaid!.json()) as {
      accepts: Array<import('../mcp/src/types.js').PaymentRequirements>;
    };
    const paymentId = randomUUID();
    const header = encodePayload({
      x402Version: 1,
      paymentId,
      nonce: paymentId,
      accepted: quote.accepts[0]!,
      eip3009: {
        from: PAYER_A,
        to: ctx.config.payTo,
        value: quote.accepts[0]!.maxAmountRequired,
        validAfter: '0',
        validBefore: '9999999999',
        nonce: `0x${'11'.repeat(32)}`,
        signature: `0x${'22'.repeat(65)}`,
      },
    });
    const first = await handleBlip(new Request(blipUrl(), { headers: { 'X-PAYMENT': header } }), ctx);
    expect(first?.status).toBe(200);
    const plant = ctx.blipPlant as FakeBlipPlant;
    expect(plant.calls).toBe(1);
    const second = await handleBlip(new Request(blipUrl(), { headers: { 'X-PAYMENT': header } }), ctx);
    expect(second?.status).toBe(200);
    const body = (await second!.json()) as { replayed?: boolean; tokenId?: number };
    expect(body.replayed).toBe(true);
    expect(body.tokenId).toBe(0);
    expect(plant.calls).toBe(1);
    expect(ctx.blips.count()).toBe(1);
    expect(await ctx.blipsMinter.totalSupply()).toBe(1);
    expect((ctx.facilitator as MemoryFacilitator).debitCount()).toBe(1);
  });

  it('failed plant → no charge', async () => {
    const plant = new FakeBlipPlant();
    plant.failNext = 'ffmpeg missing';
    const ctx = makeCtx({}, { blipPlant: plant });
    const res = await pay(blipUrl(), ctx);
    expect(res.status).toBe(502);
    const body = (await res.json()) as { paid: boolean; charged: boolean };
    expect(body.paid).toBe(false);
    expect(body.charged).toBe(false);
    expect(plant.calls).toBe(1);
    expect((ctx.facilitator as MemoryFacilitator).debitCount()).toBe(0);
    expect(ctx.blips.count()).toBe(0);
  });

  it('mintIndex follows settled paid mints (and minter totalSupply)', async () => {
    const ctx = makeCtx();
    const first = await pay(blipUrl('still', 'one'), ctx);
    expect(((await first.json()) as { mintIndex: number }).mintIndex).toBe(0);
    const second = await pay(blipUrl('motion:orb', 'two'), ctx);
    const body = (await second.json()) as { mintIndex: number; priceCents: number; picture: string };
    expect(body.mintIndex).toBe(1);
    expect(body.priceCents).toBe(blipPriceCents(1));
    expect(body.picture).toBe('motion:orb');
    expect(ctx.blips.count()).toBe(2);
  });

  it('402 at mintIndex 100 is quadratic 23¢ not flat 6¢', async () => {
    const minter = new MemoryBlipsMinter();
    const ctx = makeCtx({}, { blipsMinter: minter });
    for (let i = 0; i < 100; i += 1) {
      await minter.mint({
        ownerWallet: PAYER_A,
        tokenURI: `https://api.clearing.dev/v1/blip/metadata/${i}`,
        mintIndex: i,
      });
    }
    const res = await handleBlip(new Request(blipUrl()), ctx);
    const body = (await res!.json()) as { accepts: Array<{ maxAmountRequired: string; extra: { priceCents: number } }> };
    expect(body.accepts[0]?.extra.priceCents).toBe(23);
    expect(body.accepts[0]?.maxAmountRequired).toBe('230000');
  });

  it('My Account reads minter-owned tokenIds (not soft-DB alone)', async () => {
    const ctx = makeCtx();
    await pay(blipUrl(), ctx);
    const res = await handleHangar(
      new Request(`https://api.clearing.dev/v1/blip/owned?wallet=${PAYER_A}`),
      ctx,
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      source: string;
      market: boolean;
      tokens: Array<{ tokenId: number; mintTx: string; videoUrl?: string }>;
    };
    expect(body.source).toBe('chain-minter');
    expect(body.market).toBe(false);
    expect(body.tokens).toHaveLength(1);
    expect(body.tokens[0]?.tokenId).toBe(0);
    expect(body.tokens[0]?.mintTx).toMatch(/^0x/);
    expect(body.tokens[0]?.videoUrl).toMatch(/\.mp4$/);
  });

  it('My Account lists chain NFTs when minter and hangar receipts are empty', async () => {
    const nft = '0x978295330Ba861b2A45432F0942Dde61679fDDBd' as const;
    const wallet = '0x00552afc18275c7723dad2EC95d77308738cE07e' as const;
    const ctx = makeCtx(
      {},
      {
        config: { blipsNft: nft },
        blipsMinter: new MemoryBlipsMinter(),
        fetch: async (input, init) => {
          const body = JSON.parse(String(init?.body ?? '{}')) as {
            method?: string;
            params?: Array<{ data?: string }>;
          };
          if (body.method !== 'eth_call') {
            return Response.json({ error: { message: `unexpected ${body.method}` } }, { status: 500 });
          }
          const data = body.params?.[0]?.data ?? '';
          const sel = data.slice(0, 10).toLowerCase();
          if (sel === '0x70a08231') return Response.json({ result: uintWord(4) });
          if (sel === '0x2f745c59') {
            const index = Number(BigInt(`0x${data.slice(74)}`));
            return Response.json({ result: uintWord(index) });
          }
          if (sel === '0xc87b56dd') {
            const tokenId = Number(BigInt(`0x${data.slice(10)}`));
            return Response.json({ result: abiString(`https://api.clearing.dev/v1/blip/metadata/${tokenId}`) });
          }
          if (sel === '0x6352211e') return Response.json({ result: addrWord(wallet) });
          return Response.json({ error: { message: `unexpected sel ${sel}` } }, { status: 500 });
        },
      },
    );
    ctx.blips.add({
      mintIndex: 0,
      tokenId: 0,
      ownerWallet: wallet,
      mintTx: `0x${'11'.repeat(32)}`,
      paymentId: 'receipt-0',
      priceCents: 5,
      picture: 'still',
      brief: 'night alley still',
      videoUrl: 'https://cdn.example/0.mp4',
      durationSec: 4.44,
      plantVersion: 'test',
      tokenURI: 'https://api.clearing.dev/v1/blip/metadata/0',
      settledAt: '2026-09-15T00:00:00.000Z',
    });
    const res = await handleHangar(
      new Request(`https://api.clearing.dev/v1/blip/owned?wallet=${wallet}`),
      ctx,
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      source: string;
      tokens: Array<{ tokenId: number; mintTx?: string; videoUrl?: string; tokenURI: string }>;
    };
    expect(body.source).toBe('chain');
    expect(body.tokens.map((t) => t.tokenId)).toEqual([0, 1, 2, 3]);
    expect(await ctx.blipsMinter.tokensOf(wallet)).toEqual([]);
    expect(body.tokens[0]?.videoUrl).toMatch(/\.mp4$/);
    expect(body.tokens[0]?.mintTx).toMatch(/^0x[a-f0-9]{64}$/);
    expect(body.tokens[1]?.videoUrl).toBeUndefined();
    expect(body.tokens[1]?.tokenURI).toBe('https://api.clearing.dev/v1/blip/metadata/1');
  });

  it('tokenURI metadata includes 4.44s media + receipt fields', async () => {
    const ctx = makeCtx();
    await pay(blipUrl(), ctx);
    const res = await handleHangar(new Request('https://api.clearing.dev/v1/blip/metadata/0'), ctx);
    const body = (await res.json()) as {
      animation_url: string;
      attributes: Array<{ trait_type: string; value: unknown }>;
      receipt: { mintTx: string };
    };
    expect(body.animation_url).toMatch(/\.mp4$/);
    expect(body.attributes.some((a) => a.trait_type === 'durationSec' && a.value === 4.44)).toBe(true);
    expect(body.attributes.some((a) => a.trait_type === 'escalator' && a.value === 'quadratic-ease-in')).toBe(true);
    expect(body.attributes.some((a) => a.trait_type === 'brief')).toBe(true);
    expect(body.attributes.some((a) => a.trait_type === 'picture')).toBe(true);
    expect(body.attributes.some((a) => a.trait_type === 'motion')).toBe(true);
    expect(body.attributes.some((a) => a.trait_type === 'mill')).toBe(true);
    expect(body.receipt.mintTx).toMatch(/^0x/);
    expect(String((body as { description?: string }).description)).toMatch(/night alley still/);
  });

  it('tokenURI and traits use clearing.rippel.ai, never Railway', async () => {
    const ctx = makeCtx(
      {},
      {
        config: {
          extractBaseUrl: 'https://clearing-production-9968.up.railway.app',
          publicUrl: 'https://clearing-production-9968.up.railway.app',
        },
      },
    );
    const paid = await pay(blipUrl('motion:destination', 'neon fuse driving toward the horizon'), ctx);
    expect(paid.status).toBe(200);
    const mint = (await paid.json()) as { tokenURI?: string };
    expect(mint.tokenURI).toBe('https://clearing.rippel.ai/v1/blip/metadata/0');
    const res = await handleHangar(new Request('https://api.clearing.dev/v1/blip/metadata/0'), ctx);
    const body = (await res.json()) as {
      description: string;
      animation_url: string;
      external_url?: string;
      attributes: Array<{ trait_type: string; value: unknown }>;
    };
    expect(body.animation_url).not.toMatch(/up\.railway\.app/);
    expect(body.external_url ?? '').not.toMatch(/up\.railway\.app/);
    expect(body.description).toMatch(/neon fuse driving toward the horizon/);
    expect(body.attributes.some((a) => a.trait_type === 'brief' && a.value === 'neon fuse driving toward the horizon')).toBe(
      true,
    );
    expect(body.attributes.some((a) => a.trait_type === 'motion' && a.value === 'destination')).toBe(true);
    expect(JSON.stringify(body)).not.toMatch(/up\.railway\.app/);
  });

  it('MCP blip wrapper quotes the hangar 402 (dry_run, no charge)', async () => {
    const ctx = makeCtx();
    const result = (await handleTool(
      'blip',
      { picture: 'still', brief: 'cue', owner: PAYER_A, dryRun: true },
      ctx,
    )) as { paid: boolean; status: number; quote?: { accepts?: Array<{ extra?: { signer?: string } }> } };
    expect(result.paid).toBe(false);
    expect(result.status).toBe(402);
    expect(result.quote?.accepts?.[0]?.extra?.signer).toBe('zigzag');
    expect((ctx.facilitator as MemoryFacilitator).debitCount()).toBe(0);
  });

  it('millCardFromReceipt copies factory receipt into NFT mill card', () => {
    const mill = millCardFromReceipt({
      seed: '0xdeadbeef',
      engine: 'scene-headless',
      look: 'destination-blip',
      organ: 'destination',
      genre: 'destination',
      pair: 'ember',
      hex: '#ED681F',
      motionId: 'destination',
    });
    expect(mill).toMatchObject({
      seed: '0xdeadbeef',
      engine: 'scene-headless',
      organ: 'destination',
      scenePair: 'ember',
      sceneHex: '#ED681F',
      motionId: 'destination',
    });
  });
});
