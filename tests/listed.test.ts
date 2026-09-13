import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { parseListedSeed } from '../mcp/src/config.js';
import { createContext } from '../mcp/src/context.js';
import { handleExtract } from '../mcp/src/extract.js';
import { FileListedBoard, handleListed, listedPath } from '../mcp/src/listed.js';
import { handlePin } from '../mcp/src/pin.js';
import { IDENTITY_REGISTRY } from '../mcp/src/types.js';

const OWNER = '0xd45CcF98D6db5A36E7CdD10ffae0b685BF27CE43';
const CARD_URI = 'https://example.com/8004.json';
const MCP_URL = 'https://shop.example/mcp';
const STORE_URL = 'https://shop.example/extract';

function abiString(s: string): string {
  const data = Buffer.from(s, 'utf8');
  const len = data.length.toString(16).padStart(64, '0');
  const body = data.toString('hex').padEnd(Math.ceil(data.length / 32) * 64, '0');
  return `0x${'20'.padStart(64, '0')}${len}${body}`;
}

function ownerWord(addr: string): string {
  return `0x${addr.slice(2).toLowerCase().padStart(64, '0')}`;
}

function liveCard(extra: Record<string, unknown> = {}) {
  return {
    name: 'grok',
    endpoints: { mcp: MCP_URL, http: STORE_URL },
    ...extra,
  };
}

function pinFetch(card: unknown = liveCard()) {
  return async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    if (url.includes('shop.example/mcp')) {
      return Response.json({ protocol: 'mcp', tools: ['status'] });
    }
    if (url.includes('shop.example/extract')) {
      return new Response(JSON.stringify({ accepts: [] }), {
        status: 402,
        headers: { 'www-authenticate': 'x402' },
      });
    }
    if (url.includes('dead.example')) {
      return new Response('nope', { status: 500 });
    }
    if (url.includes('example.com/8004.json')) {
      return new Response(JSON.stringify(card), { headers: { 'content-type': 'application/json' } });
    }
    const body = JSON.parse(String(init?.body ?? '{}')) as { params?: [{ data?: string }] };
    const data = body.params?.[0]?.data ?? '';
    if (data.startsWith('0x6352211e')) return Response.json({ result: ownerWord(OWNER) });
    if (data.startsWith('0xc87b56dd')) return Response.json({ result: abiString(CARD_URI) });
    return Response.json({ error: { message: 'unexpected' } }, { status: 500 });
  };
}

function pinCtx(card: unknown = liveCard(), now = new Date('2026-09-13T21:00:00.000Z')) {
  return createContext({
    now: () => now,
    config: { allowFake: true, signer: 'fake', facilitator: 'memory', payTo: OWNER },
    resolveHost: async () => ['203.0.113.10'],
    fetch: pinFetch(card),
  });
}

async function payPin(ctx: ReturnType<typeof createContext>, agentId: number, paymentId: string) {
  const unpaid = await handlePin(new Request(`http://127.0.0.1/v1/pin?agentId=${agentId}`), ctx);
  const quoted = (await unpaid!.json()) as { accepts: import('../mcp/src/types.js').PaymentRequirements[] };
  const { encodePayload } = await import('../mcp/src/x402.js');
  const header = encodePayload({
    x402Version: 1,
    paymentId,
    nonce: paymentId,
    accepted: quoted.accepts[0]!,
  });
  return handlePin(
    new Request(`http://127.0.0.1/v1/pin?agentId=${agentId}`, { headers: { 'X-PAYMENT': header } }),
    ctx,
  );
}

describe('hangar listed board', () => {
  it('unpaid pin stays 402 and does not list', async () => {
    const ctx = pinCtx();
    const unpaid = await handlePin(new Request('http://127.0.0.1/v1/pin?agentId=86025'), ctx);
    expect(unpaid?.status).toBe(402);
    const listed = handleListed(new Request('http://127.0.0.1/v1/listed'), ctx.listed);
    expect(listed?.status).toBe(200);
    expect(await listed!.json()).toEqual([]);
  });

  it('successful pin + live MCP/store lists newest-first with proof', async () => {
    let t = Date.parse('2026-09-13T21:00:00.000Z');
    const ctx = createContext({
      now: () => new Date(t),
      config: { allowFake: true, signer: 'fake', facilitator: 'memory', payTo: OWNER },
      resolveHost: async () => ['203.0.113.10'],
      fetch: pinFetch(),
    });
    const first = await payPin(ctx, 86025, 'pin-old');
    expect(first?.status).toBe(200);
    expect(((await first!.json()) as { listed: boolean }).listed).toBe(true);
    t += 1000;
    const second = await payPin(ctx, 86556, 'pin-new');
    expect(second?.status).toBe(200);

    const listed = handleListed(new Request('http://127.0.0.1/v1/listed'), ctx.listed);
    const rows = (await listed!.json()) as Array<{
      agentId: number;
      pinnedAt: string;
      paymentId: string;
      tx?: string;
      mcpUrl?: string;
      storeUrl?: string;
      liveAt?: string;
    }>;
    expect(rows.map((r) => r.agentId)).toEqual([86556, 86025]);
    expect(rows[0]?.paymentId).toBe('pin-new');
    expect(rows[0]?.tx).toMatch(/^0x/);
    expect(rows[0]?.mcpUrl).toBe(MCP_URL);
    expect(rows[0]?.storeUrl).toBe(STORE_URL);
    expect(rows[0]?.liveAt).toBeTruthy();
    expect(rows[0]!.pinnedAt > rows[1]!.pinnedAt).toBe(true);
  });

  it('identity-only pin settles but is not listed', async () => {
    const ctx = pinCtx({ name: 'blinky', services: [{ name: 'DID', endpoint: 'did:groover:x' }] });
    const paid = await payPin(ctx, 86556, 'pin-id-only');
    expect(paid?.status).toBe(200);
    const body = (await paid!.json()) as { listed: boolean; paid: boolean };
    expect(body.paid).toBe(true);
    expect(body.listed).toBe(false);
    expect(ctx.listed.list()).toEqual([]);
  });

  it('http shop URL is not listed', async () => {
    const ctx = pinCtx({ endpoints: { mcp: 'http://shop.example/mcp' } });
    const paid = await payPin(ctx, 86025, 'pin-http');
    expect(paid?.status).toBe(200);
    expect(((await paid!.json()) as { listed: boolean }).listed).toBe(false);
    expect(ctx.listed.list()).toEqual([]);
  });

  it('dead HTTPS shop is not listed', async () => {
    const ctx = pinCtx({ endpoints: { mcp: 'https://dead.example/mcp' } });
    const paid = await payPin(ctx, 86025, 'pin-dead');
    expect(paid?.status).toBe(200);
    expect(ctx.listed.list()).toEqual([]);
  });

  it('replayed paymentId does not duplicate the list', async () => {
    const ctx = pinCtx();
    const a = await payPin(ctx, 86025, 'pin-replay');
    const b = await payPin(ctx, 86025, 'pin-replay');
    expect(a?.status).toBe(200);
    expect(b?.status).toBe(200);
    expect(ctx.listed.list()).toHaveLength(1);
  });

  it('GET /v1/listed is unpaid public JSON', async () => {
    const ctx = pinCtx();
    const res = handleListed(new Request('http://127.0.0.1/v1/listed'), ctx.listed);
    expect(res?.status).toBe(200);
    expect(res?.headers.get('Content-Type')).toMatch(/application\/json/);
    expect(ctx.facilitator.debitCount()).toBe(0);
  });

  it('ignores non-listed paths', () => {
    const ctx = pinCtx();
    expect(handleListed(new Request('http://127.0.0.1/v1/pin?agentId=1'), ctx.listed)).toBeUndefined();
  });

  it('persists listed.jsonl and refuses identity-only rows', () => {
    const dir = mkdtempSync(join(tmpdir(), 'listed-'));
    const path = listedPath(dir);
    const board = new FileListedBoard(path);
    board.add({
      agentId: 86556,
      paymentId: 'p-skip',
      pinnedAt: '2026-09-13T21:00:00.000Z',
    });
    board.add({
      agentId: 86556,
      paymentId: 'p1',
      pinnedAt: '2026-09-13T21:00:00.000Z',
      tx: '0xabcabcabcabcabcabcabcabcabcabcabcabcabcabcabcabcabcabcabcabcabca',
      mcpUrl: MCP_URL,
      liveAt: '2026-09-13T21:00:00.000Z',
    });
    expect(board.list()).toHaveLength(1);
    const reloaded = new FileListedBoard(path);
    expect(reloaded.list()).toEqual([
      {
        agentId: 86556,
        paymentId: 'p1',
        pinnedAt: '2026-09-13T21:00:00.000Z',
        tx: '0xabcabcabcabcabcabcabcabcabcabcabcabcabcabcabcabcabcabcabcabcabca',
        mcpUrl: MCP_URL,
        liveAt: '2026-09-13T21:00:00.000Z',
      },
    ]);
  });

  it('backfills listedSeed only when a live shop URL is present', () => {
    const dir = mkdtempSync(join(tmpdir(), 'listed-seed-'));
    const ctx = createContext({
      persist: true,
      config: {
        allowFake: true,
        signer: 'fake',
        facilitator: 'memory',
        dataDir: dir,
        listedSeed: [
          { agentId: 86556, mcpUrl: 'https://clearing-production-9968.up.railway.app/mcp' },
          { agentId: 86666, storeUrl: 'https://clearing-production-9968.up.railway.app/v1/extract' },
        ],
      },
    });
    const rows = ctx.listed.list();
    expect(rows.map((r) => r.agentId)).toEqual([86666, 86556]);
    expect(rows[0]?.storeUrl).toContain('/v1/extract');
    expect(rows[1]?.mcpUrl).toContain('/mcp');
  });

  it('parseListedSeed ignores bare identity-only ids', () => {
    expect(parseListedSeed('86556,86666')).toEqual([]);
    expect(parseListedSeed('86556|https://clearing-production-9968.up.railway.app/mcp')).toEqual([
      { agentId: 86556, mcpUrl: 'https://clearing-production-9968.up.railway.app/mcp' },
    ]);
  });

  it('llms.txt says pin + live MCP/hangar store → listed', async () => {
    const ctx = pinCtx();
    const res = await handleExtract(new Request('http://127.0.0.1/llms.txt'), ctx);
    const text = await res.text();
    expect(text).toMatch(/pay pin \(\$0\.01 USDC Base\) \+ live HTTPS MCP or hangar store/i);
    expect(text).toContain('listed: GET /v1/listed');
    expect(text).toMatch(/Identity-only cards are not listed/);
  });

  it('canonical registry unchanged', () => {
    expect(IDENTITY_REGISTRY.toLowerCase()).toBe('0x8004a169fb4a3325136eb29fa0ceb6d2e539a432');
  });
});
