import { describe, expect, it } from 'vitest';
import { createContext } from '../mcp/src/context.js';
import { handleHangar } from '../mcp/src/http.js';

const PAY = '0xc9cD4E19e8fFabFC479352680295ba12e454462D' as const;

describe('GET /v1/listings', () => {
  it('unpaid status of four directories plus bazaar note', async () => {
    const ctx = createContext({
      config: { allowFake: true, signer: 'fake', facilitator: 'memory', payTo: PAY },
      fetch: async (input) => {
        const u = String(input);
        if (u.includes('eth_') || u.includes('base.org')) {
          return new Response(JSON.stringify({ jsonrpc: '2.0', id: 1, error: { message: 'no chain' } }));
        }
        if (u.includes('agent-card')) return new Response('{"protocolVersion":"0.3.0"}', { status: 200 });
        if (u.includes('/v1/')) return new Response('{}', { status: 402 });
        return new Response('no', { status: 404 });
      },
    });
    const res = await handleHangar(new Request('https://clearing.rippel.ai/v1/listings?agentId=91094'), ctx);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { directories: number; yellowPages: string; bazaar: { indexed: boolean } };
    expect(body.directories).toBe(4);
    expect(body.yellowPages).toBe('cdp-bazaar');
    expect(body.bazaar.indexed).toBe(false);
  });
});
