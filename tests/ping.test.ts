import { describe, expect, it } from 'vitest';
import { createContext } from '../mcp/src/context.js';
import { handlePing } from '../mcp/src/ping.js';
import { handleHangar } from '../mcp/src/http.js';

const PAY = '0xc9cD4E19e8fFabFC479352680295ba12e454462D' as const;

describe('GET /v1/ping', () => {
  it('402 then paid: target 402 = live', async () => {
    const ctx = createContext({
      config: { allowFake: true, signer: 'fake', facilitator: 'memory', payTo: PAY },
      fetch: async (input) => {
        const u = String(input);
        if (u.includes('skim')) return new Response('{}', { status: 402 });
        return new Response('ok', { status: 200 });
      },
    });
    const unpaid = await handlePing(
      new Request('https://clearing.rippel.ai/v1/ping?url=https://clearing.rippel.ai/v1/skim?url=https://example.com'),
      ctx,
    );
    expect(unpaid?.status).toBe(402);
    const quoted = (await unpaid!.json()) as {
      accepts: Array<{ maxAmountRequired: string }>;
      resource: { url: string };
    };
    expect(quoted.accepts[0]?.maxAmountRequired).toBe('10000');
    expect(quoted.resource.url).toBe('https://clearing.rippel.ai/v1/skim');
    const { encodePayload } = await import('../mcp/src/x402.js');
    const header = encodePayload({
      x402Version: 1,
      paymentId: 'ping-1',
      nonce: 'ping-1',
      accepted: quoted.accepts[0] as never,
    });
    const live = await handlePing(
      new Request('https://clearing.rippel.ai/v1/ping?url=https://clearing.rippel.ai/v1/skim?url=https://example.com', {
        headers: { 'X-PAYMENT': header },
      }),
      ctx,
    );
    expect(live?.status).toBe(200);
    const body = (await live!.json()) as { paid: boolean; pings: Array<{ live: boolean; status: number }> };
    expect(body.paid).toBe(true);
    expect(body.pings[0]?.live).toBe(true);
    expect(body.pings[0]?.status).toBe(402);
  });

  it('rejects railway.app targets', async () => {
    const ctx = createContext({
      config: { allowFake: true, signer: 'fake', facilitator: 'memory', payTo: PAY },
    });
    const res = await handlePing(
      new Request('http://127.0.0.1/v1/ping?url=https://x.up.railway.app/v1/skim'),
      ctx,
    );
    expect(res?.status).toBe(400);
  });

  it('refuses to list /v1/ping as the Bazaar resource', async () => {
    const ctx = createContext({
      config: { allowFake: true, signer: 'fake', facilitator: 'memory', payTo: PAY },
    });
    const res = await handlePing(
      new Request('https://clearing.rippel.ai/v1/ping?url=https://clearing.rippel.ai/v1/ping'),
      ctx,
    );
    expect(res?.status).toBe(400);
  });

  it('paid ping with CDP keys settles Coinbase not ZigZag', async () => {
    const { generateKeyPairSync } = await import('node:crypto');
    const { privateKey } = generateKeyPairSync('ed25519');
    const jwk = privateKey.export({ format: 'jwk' });
    const secret = Buffer.concat([
      Buffer.from(jwk.d!, 'base64url'),
      Buffer.from(jwk.x!, 'base64url'),
    ]).toString('base64');
    const prevId = process.env.CDP_API_KEY_ID;
    const prevSecret = process.env.CDP_API_KEY_SECRET;
    process.env.CDP_API_KEY_ID = '00000000-0000-4000-8000-00000000000a';
    process.env.CDP_API_KEY_SECRET = secret;
    const urls: string[] = [];
    const cataloged: string[] = [];
    try {
      const ctx = createContext({
        config: { allowFake: true, signer: 'fake', facilitator: 'memory', payTo: PAY },
        fetch: async (input, init) => {
          const u = String(input);
          urls.push(u);
          if (u.includes('zigzag')) {
            return new Response('zigzag must not run', { status: 500 });
          }
          if (u.endsWith('/x402/verify') || u.endsWith('/x402/settle')) {
            const body = JSON.parse(String(init?.body ?? '{}')) as {
              paymentPayload?: { resource?: { url?: string } };
            };
            const resource = body.paymentPayload?.resource?.url ?? '';
            cataloged.push(resource);
            expect(resource).toBe('https://clearing.rippel.ai/v1/skim');
            expect(resource.includes('/v1/ping')).toBe(false);
            if (u.endsWith('/x402/verify')) return new Response(JSON.stringify({ isValid: true }));
            return new Response(JSON.stringify({ success: true, transaction: `0x${'cd'.repeat(32)}` }));
          }
          if (u.includes('skim')) return new Response('{}', { status: 402 });
          return new Response('ok', { status: 200 });
        },
      });
      const unpaid = await handlePing(
        new Request('https://clearing.rippel.ai/v1/ping?url=https://clearing.rippel.ai/v1/skim?url=https://example.com'),
        ctx,
      );
      const quoted = (await unpaid!.json()) as { accepts: Array<never> };
      const { encodePayload } = await import('../mcp/src/x402.js');
      const header = encodePayload({
        x402Version: 1,
        paymentId: 'ping-cdp-live',
        nonce: 'ping-cdp-live',
        accepted: quoted.accepts[0] as never,
        eip3009: {
          from: '0x234a4B961908b20114980AF00c0974123763b48C',
          to: PAY,
          value: '10000',
          validAfter: '0',
          validBefore: '9999999999',
          nonce: `0x${'33'.repeat(32)}`,
          signature: `0x${'44'.repeat(65)}`,
        },
      });
      const live = await handlePing(
        new Request('https://clearing.rippel.ai/v1/ping?url=https://clearing.rippel.ai/v1/skim?url=https://example.com', {
          headers: { 'X-PAYMENT': header },
        }),
        ctx,
      );
      expect(live?.status).toBe(200);
      const body = (await live!.json()) as { paid: boolean; facilitator: string; pings: Array<{ live: boolean }> };
      expect(body.paid).toBe(true);
      expect(body.facilitator).toBe('cdp');
      expect(body.pings[0]?.live).toBe(true);
      expect(cataloged[0]).toBe('https://clearing.rippel.ai/v1/skim');
      expect(urls.some((u) => u.includes('/platform/v2/x402/settle'))).toBe(true);
      expect(urls.some((u) => u.includes('zigzag'))).toBe(false);
    } finally {
      if (prevId === undefined) delete process.env.CDP_API_KEY_ID;
      else process.env.CDP_API_KEY_ID = prevId;
      if (prevSecret === undefined) delete process.env.CDP_API_KEY_SECRET;
      else process.env.CDP_API_KEY_SECRET = prevSecret;
    }
  });

  it('hangar routes /v1/ping as 402 shop', async () => {
    const ctx = createContext({
      config: { allowFake: true, signer: 'fake', facilitator: 'memory', payTo: PAY },
      fetch: async () => new Response('', { status: 402 }),
    });
    const res = await handleHangar(
      new Request('https://clearing.rippel.ai/v1/ping?url=https://clearing.rippel.ai/v1/extract?url=https://example.com'),
      ctx,
    );
    expect(res.status).toBe(402);
  });
});
