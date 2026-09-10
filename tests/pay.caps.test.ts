import { describe, expect, it } from 'vitest';
import { fetchPaid } from '../mcp/src/pay.js';
import { handleTool } from '../mcp/src/tools.js';
import { makeCtx, urlOf } from './helpers.js';

describe('caps and origin policy', () => {
  it('quote $2 with cap $0.50 → no request', async () => {
    const record: string[] = [];
    const ctx = makeCtx({}, { config: { perTxCapUsd: 0.5, confirmAboveUsd: 0.25 } });
    const inner = ctx.fetch;
    ctx.fetch = async (input, init) => {
      record.push(urlOf(input));
      return inner(input, init);
    };
    await expect(
      fetchPaid({
        url: 'https://api.clearing.dev/v1/extract?url=https://example.com',
        maxUsd: 2,
        dryRun: false,
      }, ctx),
    ).rejects.toMatchObject({ code: 'per_tx_cap' });
    expect(record).toEqual([]);
  });

  it('origin neither allowlisted nor discover-live → reject before GET', async () => {
    const record: string[] = [];
    const ctx = makeCtx();
    const inner = ctx.fetch;
    ctx.fetch = async (input, init) => {
      record.push(urlOf(input));
      return inner(input, init);
    };
    await expect(
      fetchPaid({ url: 'https://evil.example/paid', maxUsd: 0.1, dryRun: false }, ctx),
    ).rejects.toMatchObject({ code: 'origin_rejected' });
    expect(record).toEqual([]);
  });

  it('dry_run default does not spend', async () => {
    const ctx = makeCtx();
    const result = (await handleTool(
      'extract',
      { url: 'https://example.com' },
      ctx,
    )) as { dryRun: boolean; paid: boolean };
    expect(result.dryRun).toBe(true);
    expect(result.paid).toBe(false);
    expect(ctx.ledger.list()).toHaveLength(0);
  });

  it('quote ≥ confirmAboveUsd returns needs_approval even when dry_run=false unless approved', async () => {
    const ctx = makeCtx({}, { config: { extractPriceUsd: 1.5, perTxCapUsd: 2, confirmAboveUsd: 1 } });
    const result = await fetchPaid(
      { url: 'https://api.clearing.dev/v1/extract?url=https://example.com', maxUsd: 2, dryRun: false },
      ctx,
    );
    expect(result.needs_approval).toBe(true);
    expect(result.paid).toBe(false);
    expect(ctx.ledger.list()).toHaveLength(0);
  });

  it('approved=true + dry_run=false pays a confirm-threshold quote', async () => {
    const ctx = makeCtx({}, { config: { extractPriceUsd: 1.5, perTxCapUsd: 2, confirmAboveUsd: 1 } });
    const result = await fetchPaid(
      {
        url: 'https://api.clearing.dev/v1/extract?url=https://example.com',
        maxUsd: 2,
        dryRun: false,
        approved: true,
      },
      ctx,
    );
    expect(result.paid).toBe(true);
  });

  it('GROK_ALWAYS_APPROVE does not approve spend', async () => {
    process.env.GROK_ALWAYS_APPROVE = '1';
    process.env.ALWAYS_APPROVE = 'true';
    const ctx = makeCtx({}, { config: { extractPriceUsd: 1.5, perTxCapUsd: 2, confirmAboveUsd: 1 } });
    const result = await fetchPaid(
      {
        url: 'https://api.clearing.dev/v1/extract?url=https://example.com',
        maxUsd: 2,
        dryRun: false,
        approved: true,
      },
      ctx,
    );
    expect(result.needs_approval).toBe(true);
    expect(result.paid).toBe(false);
    delete process.env.GROK_ALWAYS_APPROVE;
    delete process.env.ALWAYS_APPROVE;
  });

  it('rejected payment is failed, not settled, and does not occupy spend', async () => {
    const ctx = makeCtx();
    const inner = ctx.fetch;
    ctx.fetch = async (input, init) => {
      const headers = new Headers(init?.headers);
      if (headers.get('X-PAYMENT')) {
        return new Response(JSON.stringify({ error: 'bad payment' }), { status: 402 });
      }
      return inner(input, init);
    };
    const result = await fetchPaid({
      url: 'https://api.clearing.dev/v1/extract?url=https://example.com',
      maxUsd: 0.05,
      dryRun: false,
    }, ctx);
    expect(result.paid).toBe(false);
    expect(result.receipt?.status).toBe('failed');
    expect(ctx.ledger.spentUsd({ sessionId: ctx.config.sessionId })).toBe(0);
  });

  it('missing rail fails closed', async () => {
    const ctx = makeCtx({}, { config: { allowFake: false, signer: 'x402_fetch', facilitator: 'none' } });
    await expect(
      fetchPaid(
        { url: 'https://api.clearing.dev/v1/extract?url=https://example.com', maxUsd: 0.05, dryRun: false },
        ctx,
      ),
    ).rejects.toMatchObject({ code: 'rail_missing' });
  });
});
