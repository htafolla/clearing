import { fail } from './errors.js';
import { originAllowed, parseHttpUrl } from './origin.js';
import type { ClearingConfig } from './types.js';

export type PayGate =
  | { action: 'reject'; code: string; error: string }
  | { action: 'needs_approval'; quoteUsd: number }
  | { action: 'dry_run'; quoteUsd: number }
  | { action: 'proceed'; quoteUsd: number };

export function alwaysApproveInjected(env: NodeJS.ProcessEnv = process.env): boolean {
  const grok = env.GROK_ALWAYS_APPROVE;
  const always = env.ALWAYS_APPROVE;
  return grok === '1' || grok === 'true' || always === '1' || always === 'true';
}

export function maxUsdGate(maxUsd: number, config: ClearingConfig): void {
  if (!Number.isFinite(maxUsd) || maxUsd <= 0) {
    fail('bad_max_usd', 'maxUsd must be a positive number');
  }
  if (maxUsd > config.perTxCapUsd) {
    fail('per_tx_cap', `maxUsd ${maxUsd} exceeds perTxCapUsd ${config.perTxCapUsd}`, 402);
  }
}

export function quoteGate(opts: {
  quoteUsd: number;
  maxUsd: number;
  remainingSession: number;
  remainingDaily: number;
  dryRun: boolean;
  approved: boolean;
  config: ClearingConfig;
}): PayGate {
  const approved = alwaysApproveInjected() ? false : opts.approved;
  const { quoteUsd, maxUsd, remainingSession, remainingDaily, dryRun, config } = opts;
  if (quoteUsd > maxUsd) {
    return { action: 'reject', code: 'over_max', error: `quote ${quoteUsd} exceeds maxUsd ${maxUsd}` };
  }
  if (quoteUsd > config.perTxCapUsd) {
    return { action: 'reject', code: 'per_tx_cap', error: `quote ${quoteUsd} exceeds perTxCapUsd ${config.perTxCapUsd}` };
  }
  if (quoteUsd > remainingSession) {
    return { action: 'reject', code: 'session_cap', error: `quote ${quoteUsd} exceeds remaining session cap ${remainingSession}` };
  }
  if (quoteUsd > remainingDaily) {
    return { action: 'reject', code: 'daily_cap', error: `quote ${quoteUsd} exceeds remaining daily cap ${remainingDaily}` };
  }
  if (dryRun) {
    if (quoteUsd >= config.confirmAboveUsd) {
      return { action: 'needs_approval', quoteUsd };
    }
    return { action: 'dry_run', quoteUsd };
  }
  if (quoteUsd >= config.confirmAboveUsd) {
    const headless = process.env.CLEARING_HEADLESS === '1' || process.env.CLEARING_HEADLESS === 'true';
    const operatorConfirm = process.env.CLEARING_CONFIRM_APPROVED === '1';
    if (!approved || (headless && !operatorConfirm)) {
      return { action: 'needs_approval', quoteUsd };
    }
  }
  return { action: 'proceed', quoteUsd };
}

export function assertBuyerOrigin(url: string, config: ClearingConfig, discoverLive: Set<string>): void {
  const parsed = parseHttpUrl(url);
  if (!originAllowed(parsed, config.allowOrigins, discoverLive)) {
    fail(
      'origin_rejected',
      `origin ${parsed.origin} is neither allowlisted nor discover-live`,
    );
  }
}

export function remainingCaps(
  spentSession: number,
  spentDaily: number,
  config: ClearingConfig,
): { remainingSession: number; remainingDaily: number } {
  return {
    remainingSession: Math.max(0, config.sessionCapUsd - spentSession),
    remainingDaily: Math.max(0, config.dailyCapUsd - spentDaily),
  };
}
