import { describe, expect, it } from 'vitest';
import { createContext } from '../mcp/src/context.js';
import { handlePing } from '../mcp/src/ping.js';
import { handleHangar } from '../mcp/src/http.js';

const PAY = '0xc9cD4E19e8fFabFC479352680295ba12e454462D' as const;

describe('GET /v1/ping', () => {
  it('unpaid: 402 = live, 200 = not a shop SYN', async () => {
    const ctx = createContext({
      config: { allowFake: true, signer: 'fake', facilitator: 'memory', payTo: PAY },
      fetch: async (input) => {
        const u = String(input);
        if (u.includes('skim')) return new Response('{}', { status: 402 });
        return new Response('ok', { status: 200 });
      },
    });
    const live = await handlePing(
      new Request('http://127.0.0.1/v1/ping?url=https://clearing.rippel.ai/v1/skim?url=https://example.com'),
      ctx,
    );
    expect(live?.status).toBe(200);
    const body = (await live!.json()) as { pings: Array<{ live: boolean; status: number }> };
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

  it('hangar routes /v1/ping unpaid', async () => {
    const ctx = createContext({
      config: { allowFake: true, signer: 'fake', facilitator: 'memory', payTo: PAY },
      fetch: async () => new Response('', { status: 402 }),
    });
    const res = await handleHangar(
      new Request('https://clearing.rippel.ai/v1/ping?url=https://clearing.rippel.ai/v1/extract?url=https://example.com'),
      ctx,
    );
    expect(res.status).toBe(200);
  });
});
