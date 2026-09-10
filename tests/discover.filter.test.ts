import { describe, expect, it } from 'vitest';
import { discover } from '../mcp/src/discover.js';
import { handleExtract } from '../mcp/src/extract.js';
import { MemoryWatchlist } from '../mcp/src/watchlist.js';
import { MemorySettlementOracle } from '../mcp/src/settlement.js';
import { makeCtx, PAYER_A, PAY_TO, seedLiveExtract } from './helpers.js';

describe('discover filter', () => {
  it('omits endpoints that fail probe even if ERC-8004 metadata exists', async () => {
    const ctx = makeCtx({
      'https://ghost.example/.well-known/agent.json': {
        body: JSON.stringify({
          name: 'Ghost',
          erc8004: '8004:base:999',
          endpoints: { http: 'https://ghost.example/paid' },
        }),
        contentType: 'application/json',
      },
      'https://ghost.example/paid': { status: 500, body: 'dead' },
    });
    (ctx.watchlist as MemoryWatchlist).upsert({
      id: 'ghost',
      origin: 'https://ghost.example',
      url: 'https://ghost.example/paid',
      category: 'api',
      cardUrl: 'https://ghost.example/.well-known/agent.json',
      erc8004Id: '8004:base:999',
      failCount: 0,
    });
    (ctx.settlements as MemorySettlementOracle).add({
      from: PAYER_A,
      to: PAY_TO,
      amountUsd: '1',
      at: ctx.now().toISOString(),
      txHash: '0xdeaddeaddeaddeaddeaddeaddeaddeaddeaddeaddeaddeaddeaddeaddeaddead',
      tag: 'external',
    });
    const rows = await discover({}, ctx);
    expect(rows.some((r) => r.origin.includes('ghost.example'))).toBe(false);
  });

  it('never returns a registration-only ERC-8004 id', async () => {
    const ctx = makeCtx({
      'https://registry.example/.well-known/agent.json': {
        body: JSON.stringify({ erc8004: '8004:base:1', id: 'eip155:8453:0xabc' }),
        contentType: 'application/json',
      },
    });
    (ctx.watchlist as MemoryWatchlist).upsert({
      id: 'reg-only',
      origin: 'https://registry.example',
      url: 'eip155:8453:0xabc',
      category: 'api',
      cardUrl: 'https://registry.example/.well-known/agent.json',
      erc8004Id: '8004:base:1',
      failCount: 0,
    });
    const rows = await discover({}, ctx);
    expect(rows).toEqual([]);
  });

  it('lists a 402 origin with 7-day USDC settlement and flags thinLiquidity', async () => {
    const ctx = makeCtx();
    seedLiveExtract(ctx);
    const card = await handleExtract(new Request('https://api.clearing.dev/.well-known/agent.json'), ctx);
    expect(card.status).toBe(200);
    const rows = await discover({ category: 'extract' }, ctx);
    expect(rows.length).toBeGreaterThan(0);
    expect(rows[0]?.origin).toContain('api.clearing.dev');
    expect(rows[0]?.thinLiquidity).toBe(false);
    expect(rows[0]?.settlements7d).toBeGreaterThanOrEqual(2);
  });

  it('flags thinLiquidity when only one distinct payer is visible', async () => {
    const ctx = makeCtx();
    (ctx.watchlist as MemoryWatchlist).upsert({
      id: 'thin',
      origin: 'https://api.clearing.dev',
      url: 'https://api.clearing.dev/v1/extract?url=https://example.com',
      category: 'extract',
      cardUrl: 'https://api.clearing.dev/.well-known/agent.json',
      failCount: 0,
    });
    (ctx.settlements as MemorySettlementOracle).add({
      from: PAYER_A,
      to: PAY_TO,
      amountUsd: '0.02',
      at: ctx.now().toISOString(),
      txHash: '0xabc1abc1abc1abc1abc1abc1abc1abc1abc1abc1abc1abc1abc1abc1abc1abc1',
      tag: 'external',
    });
    const rows = await discover({}, ctx);
    expect(rows[0]?.thinLiquidity).toBe(true);
  });

  it('drops an origin after two consecutive probe failures', async () => {
    const ctx = makeCtx({
      'https://flaky.example/.well-known/agent.json': {
        body: JSON.stringify({ endpoints: { http: 'https://flaky.example/paid' } }),
        contentType: 'application/json',
      },
      'https://flaky.example/paid': { status: 500, body: 'dead' },
    });
    (ctx.watchlist as MemoryWatchlist).upsert({
      id: 'flaky',
      origin: 'https://flaky.example',
      url: 'https://flaky.example/paid',
      category: 'api',
      cardUrl: 'https://flaky.example/.well-known/agent.json',
      failCount: 0,
    });
    await discover({}, ctx);
    await discover({}, ctx);
    expect(ctx.watchlist.list()[0]?.failCount).toBe(2);
    const rows = await discover({}, ctx);
    expect(rows.some((r) => r.origin.includes('flaky.example'))).toBe(false);
    expect(ctx.watchlist.list()[0]?.failCount).toBe(2);
  });

  it('excludes tagged soak tests from the 7-day settlement count', async () => {
    const ctx = makeCtx();
    (ctx.watchlist as MemoryWatchlist).upsert({
      id: 'soak',
      origin: 'https://api.clearing.dev',
      url: 'https://api.clearing.dev/v1/extract?url=https://example.com',
      category: 'extract',
      cardUrl: 'https://api.clearing.dev/.well-known/agent.json',
      failCount: 0,
    });
    (ctx.settlements as MemorySettlementOracle).add({
      from: PAYER_A,
      to: PAY_TO,
      amountUsd: '0.02',
      at: ctx.now().toISOString(),
      txHash: '0xabc1abc1abc1abc1abc1abc1abc1abc1abc1abc1abc1abc1abc1abc1abc1abc1',
      tag: 'soak',
    });
    const rows = await discover({}, ctx);
    expect(rows).toEqual([]);
  });
});
