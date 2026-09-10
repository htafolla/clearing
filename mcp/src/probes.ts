import { parseQuote } from './x402.js';
import type { ClearingContext } from './context.js';
import type { PaymentRequirements } from './types.js';

export type ProbeResult = {
  ok: boolean;
  status?: number;
  latencyMs: number;
  quote?: PaymentRequirements;
  error?: string;
};

export async function probeUrl(url: string, ctx: ClearingContext): Promise<ProbeResult> {
  const started = Date.now();
  try {
    const res = await ctx.fetch(url, {
      method: 'GET',
      redirect: 'follow',
      signal: AbortSignal.timeout(ctx.config.probeTimeoutMs),
    });
    const latencyMs = Date.now() - started;
    const body = await res.text();
    let parsed: unknown = undefined;
    try {
      parsed = JSON.parse(body);
    } catch {
      parsed = undefined;
    }
    const quote = res.status === 402 ? parseQuote(parsed, res.headers) : undefined;
    const ok = res.status === 402 ? Boolean(quote) : res.status >= 200 && res.status < 400 && Boolean(quote);
    return {
      ok: res.status === 402 && Boolean(quote),
      status: res.status,
      latencyMs,
      quote,
      error: ok || res.status === 402 ? undefined : `status ${res.status}`,
    };
  } catch (err) {
    return {
      ok: false,
      latencyMs: Date.now() - started,
      error: err instanceof Error ? err.message : 'probe failed',
    };
  }
}
