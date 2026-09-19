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
    const quoted = (await unpaid!.json()) as { accepts: Array<{ maxAmountRequired: string }> };
    expect(quoted.accepts[0]?.maxAmountRequired).toBe('10000');
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
