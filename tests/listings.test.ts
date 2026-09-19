import { describe, expect, it } from 'vitest';
import { createContext } from '../mcp/src/context.js';
import { handleHangar } from '../mcp/src/http.js';
import { MemoryListedBoard } from '../mcp/src/listed.js';

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

  it('bazaar indexed when CDP search returns the hangar shop URL', async () => {
    const listed = new MemoryListedBoard([
      {
        agentId: 91094,
        paymentId: 'list-1',
        pinnedAt: new Date().toISOString(),
        groover: 'did:groover:test',
        solar: 'PASS',
        storeUrl: 'https://clearing.rippel.ai/v1/skim',
        mcpUrl: 'https://clearing.rippel.ai/mcp',
        healthAt: new Date().toISOString(),
        liveAt: new Date().toISOString(),
      },
    ]);
    const ctx = createContext({
      config: { allowFake: true, signer: 'fake', facilitator: 'memory', payTo: PAY },
      listed,
      fetch: async (input) => {
        const u = String(input);
        if (u.includes('discovery/search')) {
          return new Response(
            JSON.stringify({ resources: [{ resource: 'https://clearing.rippel.ai/v1/skim' }] }),
          );
        }
        if (u.includes('eth_') || u.includes('base.org')) {
          return new Response(JSON.stringify({ jsonrpc: '2.0', id: 1, error: { message: 'no chain' } }));
        }
        if (u.includes('agent-card')) return new Response('{"protocolVersion":"0.3.0"}', { status: 200 });
        if (u.includes('/v1/')) return new Response('{}', { status: 402 });
        return new Response('no', { status: 404 });
      },
    });
    const res = await handleHangar(new Request('https://clearing.rippel.ai/v1/listings?agentId=91094'), ctx);
    const body = (await res.json()) as { bazaar: { indexed: boolean; url?: string } };
    expect(body.bazaar.indexed).toBe(true);
    expect(body.bazaar.url).toBe('https://clearing.rippel.ai/v1/skim');
  });

  it('ping uses 402 shop from the card when catalog store is a mill 200', async () => {
    const listed = new MemoryListedBoard([
      {
        agentId: 94717,
        paymentId: 'plant-1',
        pinnedAt: new Date().toISOString(),
        groover: 'did:groover:test',
        solar: 'PASS',
        storeUrl: 'https://plant.rippel.ai/',
        mcpUrl: 'https://clearing.rippel.ai/mcp',
        healthAt: new Date().toISOString(),
        liveAt: new Date().toISOString(),
      },
    ]);
    const cardUri = 'https://gist.githubusercontent.com/htafolla/test/raw/shops-card.json';
    const ctx = createContext({
      config: { allowFake: true, signer: 'fake', facilitator: 'memory', payTo: PAY },
      listed,
      fetch: async (input, init) => {
        const u = String(input);
        if (u.includes('discovery/search')) {
          return new Response(JSON.stringify({ resources: [{ resource: 'https://clearing.rippel.ai/v1/blip' }] }));
        }
        if (u.includes('base.org') || u.includes('1rpc')) {
          const payload = JSON.parse(String(init?.body ?? '{}')) as { params?: Array<{ data?: string }> };
          const data = payload.params?.[0]?.data ?? '';
          if (data.startsWith('0x6352211e')) {
            return new Response(
              JSON.stringify({
                jsonrpc: '2.0',
                id: 1,
                result: `0x${'0'.repeat(24)}234a4b961908b20114980af00c0974123763b48c`,
              }),
            );
          }
          if (data.startsWith('0xc87b56dd')) {
            const hex = Buffer.from(cardUri, 'utf8').toString('hex');
            const offset = (32).toString(16).padStart(64, '0');
            const len = cardUri.length.toString(16).padStart(64, '0');
            const pad = hex.padEnd(Math.ceil(hex.length / 64) * 64, '0');
            return new Response(JSON.stringify({ jsonrpc: '2.0', id: 1, result: `0x${offset}${len}${pad}` }));
          }
          return new Response(JSON.stringify({ jsonrpc: '2.0', id: 1, error: { message: 'no' } }));
        }
        if (u.includes('agent-card')) return new Response('{"protocolVersion":"0.3.0"}', { status: 200 });
        if (u.includes('shops-card') || u.includes('gist')) {
          return new Response(
            JSON.stringify({
              endpoints: { http: 'https://clearing.rippel.ai/v1/blip?picture=still&brief=plant' },
            }),
          );
        }
        if (u.includes('plant.rippel.ai')) {
          return new Response(JSON.stringify({ ok: true, mill: true, plant: 'blip' }), { status: 200 });
        }
        if (u.includes('/v1/blip')) return new Response('{}', { status: 402 });
        if (u.includes('/mcp')) return new Response(JSON.stringify({ protocol: 'mcp' }), { status: 200 });
        return new Response('no', { status: 404 });
      },
    });
    const res = await handleHangar(new Request('https://clearing.rippel.ai/v1/listings?agentId=94717'), ctx);
    const body = (await res.json()) as {
      ping: { ok: boolean; status?: number; url?: string };
      a2a: { url?: string };
    };
    expect(body.ping.ok).toBe(true);
    expect(body.ping.status).toBe(402);
    expect(body.ping.url).toContain('/v1/blip');
    expect(body.a2a.url).toBe('https://plant.rippel.ai/.well-known/agent-card.json');
  });
});
