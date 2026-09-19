import { describe, expect, it } from 'vitest';
import { findLiveShop, isX402ShopResponse, isLiveShopResponse } from '../mcp/src/live-shop.js';

const ctx = {
  fetch: async (input: RequestInfo | URL) => {
    const u = String(input);
    if (u.includes('plant.rippel.ai')) {
      return new Response(JSON.stringify({ ok: true, mill: true, plant: 'blip' }), { status: 200 });
    }
    if (u.includes('/v1/blip')) return new Response('{}', { status: 402 });
    if (u.includes('/mcp')) return new Response(JSON.stringify({ protocol: 'mcp', tools: ['x'] }), { status: 200 });
    return new Response('no', { status: 404 });
  },
  resolveHost: async () => ['1.1.1.1'],
  now: () => new Date('2026-09-19T00:00:00Z'),
  config: { probeTimeoutMs: 4000 },
};

describe('live shop vs mill', () => {
  it('402 is an x402 shop; mill ident is not', async () => {
    const mill = new Response(JSON.stringify({ ok: true, mill: true, plant: 'blip' }), { status: 200 });
    const shop = new Response('{}', { status: 402 });
    expect(isX402ShopResponse(shop)).toBe(true);
    expect(isX402ShopResponse(mill)).toBe(false);
    expect(isLiveShopResponse(mill, await mill.clone().text())).toBe(true);
  });

  it('findLiveShop prefers 402 endpoints.http over mill url', async () => {
    const live = await findLiveShop(
      {
        url: 'https://plant.rippel.ai',
        endpoints: {
          http: 'https://clearing.rippel.ai/v1/blip?picture=still&brief=plant',
          mcp: 'https://clearing.rippel.ai/mcp',
        },
      },
      ctx,
    );
    expect(live?.mcpUrl).toBe('https://clearing.rippel.ai/mcp');
    expect(live?.storeUrl).toContain('/v1/blip');
    expect(live?.storeUrl).not.toContain('plant.rippel.ai');
  });
});
