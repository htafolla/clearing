import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { fetchPaid } from '../mcp/src/pay.js';
import { MemoryFacilitator } from '../mcp/src/facilitator.js';
import { FakeSigner } from '../mcp/src/signer.js';
import { makeCtx } from './helpers.js';

describe('idempotency', () => {
  it('retry after TCP drop → single chain debit', async () => {
    const facilitator = new MemoryFacilitator();
    facilitator.dropAfterSettleOnce = true;
    const signer = new FakeSigner();
    const ctx = makeCtx({}, { facilitator, signer });
    const paymentId = randomUUID();
    const url = 'https://api.clearing.dev/v1/extract?url=https%3A%2F%2Fexample.com';

    const first = await fetchPaid({ url, maxUsd: 0.05, dryRun: false, paymentId }, ctx);
    expect(first.paid).toBe(false);
    expect(first.code).toBe('transport');
    expect(facilitator.debitCount()).toBe(1);
    expect(signer.signCount).toBe(1);
    expect(ctx.ledger.get(paymentId)?.status).toBe('submitted');

    const second = await fetchPaid({ url, maxUsd: 0.05, dryRun: false, paymentId }, ctx);
    expect(second.paid).toBe(true);
    expect(second.status).toBe(200);
    expect(facilitator.debitCount()).toBe(1);
    expect(signer.signCount).toBe(1);
    expect(ctx.ledger.get(paymentId)?.status).toBe('settled');
  });

  it('replayed settled row does not increment caps', async () => {
    const ctx = makeCtx();
    const paymentId = randomUUID();
    const url = 'https://api.clearing.dev/v1/extract?url=https%3A%2F%2Fexample.com';
    const first = await fetchPaid({ url, maxUsd: 0.05, dryRun: false, paymentId }, ctx);
    expect(first.paid).toBe(true);
    const spent = ctx.ledger.spentUsd({ sessionId: ctx.config.sessionId });
    const replay = await fetchPaid({ url, maxUsd: 0.05, dryRun: false, paymentId }, ctx);
    expect(replay.receipt?.status).toBe('replayed');
    expect(ctx.ledger.spentUsd({ sessionId: ctx.config.sessionId })).toBe(spent);
    expect((ctx.facilitator as MemoryFacilitator).debitCount()).toBe(1);
    expect((replay.body as { markdown?: string }).markdown).toContain('Example Domain');
  });
});
