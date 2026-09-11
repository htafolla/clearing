import { describe, expect, it } from 'vitest';
import { AwalSigner, parseAwalJson } from '../mcp/src/awal.js';
import { createSigner } from '../mcp/src/signer.js';
import { fetchPaid } from '../mcp/src/pay.js';
import { createContext } from '../mcp/src/context.js';
import { ALWAYS_ALLOW_ORIGIN } from '../mcp/src/types.js';

describe('parseAwalJson', () => {
  it('skips awal progress lines', () => {
    const parsed = parseAwalJson('- Paying...\n{"success":true,"status":200}\n');
    expect(parsed).toEqual({ success: true, status: 200 });
  });
});

describe('AwalSigner', () => {
  it('createSigner maps awal and coinbase to pay-through rail', () => {
    const a = createSigner('awal', false);
    const c = createSigner('coinbase', false);
    expect(a.kind).toBe('awal');
    expect(c.kind).toBe('coinbase');
    expect(typeof a.payThrough).toBe('function');
  });

  it('payThrough sends x402 pay --max-amount --json', async () => {
    const calls: string[][] = [];
    const signer = new AwalSigner('awal', async (args) => {
      calls.push(args);
      return { stdout: JSON.stringify({ success: true, status: 200, body: { ok: true }, txHash: '0xabc' }), stderr: '' };
    });
    const out = await signer.payThrough({
      url: 'https://clearing-production-9968.up.railway.app/v1/extract?url=https://example.com',
      maxAtomic: '20000',
    });
    expect(calls[0]).toEqual([
      'x402',
      'pay',
      'https://clearing-production-9968.up.railway.app/v1/extract?url=https://example.com',
      '--max-amount',
      '20000',
      '--json',
    ]);
    expect(out.status).toBe(200);
    expect(out.txHash).toBe('0xabc');
  });

  it('maps AUTH_REQUIRED to rail_missing', async () => {
    const signer = new AwalSigner('awal', async () => ({
      stdout: JSON.stringify({
        success: false,
        error: { code: 'AUTH_REQUIRED', message: 'Sign in' },
      }),
      stderr: '',
    }));
    await expect(
      signer.payThrough({ url: 'https://example.com', maxAtomic: '20000' }),
    ).rejects.toThrow(/AUTH_REQUIRED/);
  });
});

describe('fetchPaid awal rail', () => {
  it('after policy gates, pays through awal instead of X-PAYMENT retry', async () => {
    const signer = new AwalSigner('awal', async () => ({
      stdout: JSON.stringify({
        success: true,
        status: 200,
        body: { title: 'Example Domain', paid: true },
        txHash: '0xdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef',
      }),
      stderr: '',
    }));
    const ctx = createContext({
      config: {
        signer: 'awal',
        allowFake: true,
        payTo: '0xc9cD4E19e8fFabFC479352680295ba12e454462D',
        allowOrigins: [ALWAYS_ALLOW_ORIGIN, 'clearing-production-9968.up.railway.app'],
      },
      signer,
      fetch: async () =>
        new Response(
          JSON.stringify({
            x402Version: 1,
            accepts: [
              {
                scheme: 'exact',
                network: 'eip155:8453',
                maxAmountRequired: '20000',
                asset: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913',
                payTo: '0xc9cD4E19e8fFabFC479352680295ba12e454462D',
                resource: 'https://clearing-production-9968.up.railway.app/v1/extract',
                description: 'extract',
                mimeType: 'application/json',
                maxTimeoutSeconds: 60,
              },
            ],
          }),
          { status: 402, headers: { 'content-type': 'application/json' } },
        ),
    });
    const result = await fetchPaid(
      {
        url: 'https://clearing-production-9968.up.railway.app/v1/extract?url=https://example.com',
        maxUsd: 1,
        dryRun: false,
        approved: true,
      },
      ctx,
    );
    expect(result.paid).toBe(true);
    expect(result.txHash?.startsWith('0x')).toBe(true);
    expect(result.body).toEqual({ title: 'Example Domain', paid: true });
  });
});
