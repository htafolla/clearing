import type { ClearingContext } from './context.js';
import { maskAddress } from './config.js';
import type { Receipt } from './types.js';

export type ReceiptsArgs = {
  since?: string;
  paymentId?: string;
};

export function listReceipts(args: ReceiptsArgs, ctx: ClearingContext): Receipt[] {
  return ctx.ledger.list({ since: args.since, paymentId: args.paymentId, limit: 100 });
}

export function statusPayload(ctx: ClearingContext): Record<string, unknown> {
  const now = ctx.now().toISOString();
  const spentSession = ctx.ledger.spentUsd({ sessionId: ctx.config.sessionId });
  const spentDaily = ctx.ledger.spentUsd({ day: now.slice(0, 10) });
  return {
    signer: ctx.config.signer,
    rail: ctx.signer.kind,
    addressMasked: ctx.signer.addressMasked,
    payToMasked: maskAddress(ctx.config.payTo),
    chainId: ctx.config.chainId,
    usdc: ctx.config.usdc,
    remainingSessionUsd: Math.max(0, ctx.config.sessionCapUsd - spentSession),
    remainingDailyUsd: Math.max(0, ctx.config.dailyCapUsd - spentDaily),
    perTxCapUsd: ctx.config.perTxCapUsd,
    confirmAboveUsd: ctx.config.confirmAboveUsd,
    extractEndpoint: `${ctx.config.extractBaseUrl}/v1/extract`,
    agentCardUrl: `${ctx.config.extractBaseUrl}/.well-known/agent.json`,
    lastReceipts: ctx.ledger.list({ limit: 10 }),
    fundedHint:
      ctx.signer.kind === 'fake'
        ? 'fake signer (local). Fund a real rail before production.'
        : 'Operator funds the rail wallet. Clearing does not hold keys.',
  };
}
