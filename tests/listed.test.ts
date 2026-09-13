import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { createContext } from '../mcp/src/context.js';
import { FileLedger } from '../mcp/src/ledger.js';
import { FileListedBoard, handleListed, listedPath } from '../mcp/src/listed.js';
import { handlePin } from '../mcp/src/pin.js';
import { handleExtract } from '../mcp/src/extract.js';
import { IDENTITY_REGISTRY } from '../mcp/src/types.js';

const OWNER = '0xd45CcF98D6db5A36E7CdD10ffae0b685BF27CE43';
const CARD_URI = 'https://example.com/8004.json';

function abiString(s: string): string {
  const data = Buffer.from(s, 'utf8');
  const len = data.length.toString(16).padStart(64, '0');
  const body = data.toString('hex').padEnd(Math.ceil(data.length / 32) * 64, '0');
  return `0x${'20'.padStart(64, '0')}${len}${body}`;
}

function ownerWord(addr: string): string {
  return `0x${addr.slice(2).toLowerCase().padStart(64, '0')}`;
}

function pinCtx(now = new Date('2026-09-13T21:00:00.000Z')) {
  return createContext({
    now: () => now,
    config: { allowFake: true, signer: 'fake', facilitator: 'memory', payTo: OWNER },
    fetch: async (input, init) => {
      const url = String(input);
      if (url.includes('example.com/8004.json')) {
        return new Response(JSON.stringify({ name: 'grok' }), {
          headers: { 'content-type': 'application/json' },
        });
      }
      const body = JSON.parse(String(init?.body ?? '{}')) as { params?: [{ data?: string }] };
      const data = body.params?.[0]?.data ?? '';
      if (data.startsWith('0x6352211e')) return Response.json({ result: ownerWord(OWNER) });
      if (data.startsWith('0xc87b56dd')) return Response.json({ result: abiString(CARD_URI) });
      return Response.json({ error: { message: 'unexpected' } }, { status: 500 });
    },
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

  it('successful pin settle lists newest-first with paymentId and tx', async () => {
    let t = Date.parse('2026-09-13T21:00:00.000Z');
    const ctx = createContext({
      now: () => new Date(t),
      config: { allowFake: true, signer: 'fake', facilitator: 'memory', payTo: OWNER },
      fetch: pinCtx().fetch,
    });
    const first = await payPin(ctx, 86025, 'pin-old');
    expect(first?.status).toBe(200);
    t += 1000;
    const second = await payPin(ctx, 86556, 'pin-new');
    expect(second?.status).toBe(200);

    const listed = handleListed(new Request('http://127.0.0.1/v1/listed'), ctx.listed);
    const rows = (await listed!.json()) as Array<{
      agentId: number;
      pinnedAt: string;
      paymentId: string;
      tx?: string;
    }>;
    expect(rows.map((r) => r.agentId)).toEqual([86556, 86025]);
    expect(rows[0]?.paymentId).toBe('pin-new');
    expect(rows[0]?.tx).toMatch(/^0x/);
    expect(rows[1]?.paymentId).toBe('pin-old');
    expect(rows[0]?.pinnedAt > rows[1]!.pinnedAt).toBe(true);
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

  it('persists listed.jsonl and reloads', () => {
    const dir = mkdtempSync(join(tmpdir(), 'listed-'));
    const path = listedPath(dir);
    const board = new FileListedBoard(path);
    board.add({
      agentId: 86556,
      paymentId: 'p1',
      pinnedAt: '2026-09-13T21:00:00.000Z',
      tx: '0xabcabcabcabcabcabcabcabcabcabcabcabcabcabcabcabcabcabcabcabcabca',
    });
    board.add({
      agentId: 86556,
      paymentId: 'p1',
      pinnedAt: '2026-09-13T22:00:00.000Z',
    });
    expect(board.list()).toHaveLength(1);
    const reloaded = new FileListedBoard(path);
    expect(reloaded.list()).toEqual([
      {
        agentId: 86556,
        paymentId: 'p1',
        pinnedAt: '2026-09-13T21:00:00.000Z',
        tx: '0xabcabcabcabcabcabcabcabcabcabcabcabcabcabcabcabcabcabcabcabcabca',
      },
    ]);
  });

  it('hydrates listed rows from settled pin receipts', () => {
    const dir = mkdtempSync(join(tmpdir(), 'listed-led-'));
    const ledger = new FileLedger(join(dir, 'receipts.jsonl'));
    ledger.put({
      paymentId: 'pin-receipt-86556',
      chainId: 8453,
      token: 'USDC',
      amountUsd: '0.01',
      payTo: '0xc9cD4E19e8fFabFC479352680295ba12e454462D',
      origin: 'https://clearing-production-9968.up.railway.app',
      resource: 'https://clearing-production-9968.up.railway.app/v1/pin?agentId=86556',
      status: 'settled',
      sessionId: 's',
      createdAt: '2026-09-10T00:00:00.000Z',
      updatedAt: '2026-09-10T00:00:00.000Z',
      txHash: '0x1111111111111111111111111111111111111111111111111111111111111111',
    });
    const ctx = createContext({
      persist: true,
      ledger,
      config: {
        allowFake: true,
        signer: 'fake',
        facilitator: 'memory',
        dataDir: dir,
        listedSeed: [86666],
      },
    });
    const rows = ctx.listed.list();
    expect(rows.map((r) => r.agentId)).toEqual([86556, 86666]);
    expect(rows[0]?.paymentId).toBe('pin-receipt-86556');
    expect(rows[0]?.tx).toBe('0x1111111111111111111111111111111111111111111111111111111111111111');
  });

  it('backfills listedSeed agentIds on persist', () => {
    const dir = mkdtempSync(join(tmpdir(), 'listed-seed-'));
    const ctx = createContext({
      persist: true,
      config: {
        allowFake: true,
        signer: 'fake',
        facilitator: 'memory',
        dataDir: dir,
        listedSeed: [86556, 86666],
      },
    });
    const rows = ctx.listed.list();
    expect(rows.map((r) => r.agentId)).toEqual([86666, 86556]);
    expect(rows[0]?.paymentId).toBe('backfill:86666');
    expect(rows[1]?.paymentId).toBe('backfill:86556');
    expect(rows[0]?.tx).toBeUndefined();
  });

  it('llms.txt says pay pin → listed and names the URL', async () => {
    const ctx = pinCtx();
    const res = await handleExtract(new Request('http://127.0.0.1/llms.txt'), ctx);
    const text = await res.text();
    expect(text).toMatch(/pay pin \(\$0\.01 USDC Base\) → you appear on \/v1\/listed/i);
    expect(text).toContain('listed: GET /v1/listed');
    expect(text).toMatch(/No extra directory fee/);
  });

  it('canonical registry unchanged', () => {
    expect(IDENTITY_REGISTRY.toLowerCase()).toBe('0x8004a169fb4a3325136eb29fa0ceb6d2e539a432');
  });
});
