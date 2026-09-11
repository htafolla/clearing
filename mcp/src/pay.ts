import { newPaymentId } from './bytes.js';
import { ClearingError, fail } from './errors.js';
import { utcDay } from './ledger.js';
import { atomicToUsd, decodePayload, parseQuote } from './x402.js';
import { V1_PAYMENT_HEADER } from './x402.js';
import { assertBuyerOrigin, maxUsdGate, quoteGate, remainingCaps } from './policy.js';
import { originOf, parseHttpUrl } from './origin.js';
import type { ClearingContext } from './context.js';
import type { Receipt } from './types.js';

export type FetchPaidArgs = {
  url: string;
  maxUsd: number;
  paymentId?: string;
  dryRun?: boolean;
  approved?: boolean;
};

export type FetchPaidResult = {
  paid: boolean;
  dryRun?: boolean;
  needs_approval?: boolean;
  status: number;
  origin: string;
  url: string;
  paymentId?: string;
  amountUsd?: string;
  txHash?: string;
  receipt?: Receipt;
  body?: unknown;
  quote?: unknown;
  error?: string;
  code?: string;
};

export async function fetchPaid(args: FetchPaidArgs, ctx: ClearingContext): Promise<FetchPaidResult> {
  const dryRun = args.dryRun !== false;
  const approved = args.approved === true;
  const url = parseHttpUrl(args.url).toString();
  const origin = originOf(url);

  maxUsdGate(args.maxUsd, ctx.config);
  assertBuyerOrigin(url, ctx.config, ctx.liveDiscoverOrigins());

  const existing = args.paymentId ? ctx.ledger.get(args.paymentId) : undefined;
  if (existing?.status === 'settled' || existing?.status === 'replayed') {
    const replayed: Receipt = {
      ...existing,
      status: 'replayed',
      updatedAt: ctx.now().toISOString(),
    };
    ctx.ledger.put(replayed);
    return {
      paid: true,
      status: 200,
      origin,
      url,
      paymentId: existing.paymentId,
      amountUsd: existing.amountUsd,
      txHash: existing.txHash,
      receipt: replayed,
      body: existing.body ?? { replayed: true },
    };
  }

  const requestOnce = async (headers?: Record<string, string>): Promise<Response> => {
    return ctx.fetch(url, {
      method: 'GET',
      headers,
      redirect: 'follow',
      signal: AbortSignal.timeout(ctx.config.fetchTimeoutMs),
    });
  };

  let first: Response;
  try {
    first = await requestOnce();
  } catch (err) {
    if (existing?.payloadB64 && existing.status === 'submitted') {
      throw err;
    }
    fail('fetch_failed', err instanceof Error ? err.message : 'request failed', 502);
  }

  if (first.status !== 402) {
    const body = await readBody(first);
    return { paid: false, status: first.status, origin, url, body };
  }

  const rawQuote = await readBody(first);
  const quote = parseQuote(rawQuote, first.headers);
  if (!quote) fail('bad_quote', '402 did not include recoverable payTo/asset/amount', 502);
  const quoteUsd = atomicToUsd(quote.maxAmountRequired);
  const now = ctx.now();
  const { remainingSession, remainingDaily } = remainingCaps(
    ctx.ledger.spentUsd({ sessionId: ctx.config.sessionId }),
    ctx.ledger.spentUsd({ day: utcDay(now.toISOString()) }),
    ctx.config,
  );
  const gate = quoteGate({
    quoteUsd,
    maxUsd: args.maxUsd,
    remainingSession,
    remainingDaily,
    dryRun,
    approved,
    config: ctx.config,
  });
  if (gate.action === 'reject') {
    return { paid: false, status: 402, origin, url, quote: rawQuote, error: gate.error, code: gate.code };
  }
  if (gate.action === 'needs_approval') {
    return {
      paid: false,
      needs_approval: true,
      dryRun,
      status: 402,
      origin,
      url,
      amountUsd: String(quoteUsd),
      quote: rawQuote,
      code: 'needs_approval',
    };
  }
  if (gate.action === 'dry_run') {
    return {
      paid: false,
      dryRun: true,
      status: 402,
      origin,
      url,
      amountUsd: String(quoteUsd),
      quote: rawQuote,
    };
  }

  const paymentId = existing?.paymentId ?? args.paymentId ?? newPaymentId();
  if (ctx.signer.payThrough) {
    const createdAt = existing?.createdAt ?? now.toISOString();
    const submitted: Receipt = {
      paymentId,
      chainId: 8453,
      token: 'USDC',
      amountUsd: String(quoteUsd),
      payTo: quote.payTo,
      origin,
      resource: quote.resource || url,
      status: 'submitted',
      sessionId: ctx.config.sessionId,
      createdAt,
      updatedAt: now.toISOString(),
    };
    ctx.ledger.put(submitted);
    try {
      const paid = await ctx.signer.payThrough({ url, maxAtomic: quote.maxAmountRequired });
      if (paid.status < 200 || paid.status >= 300) {
        const failed: Receipt = { ...submitted, status: 'failed', updatedAt: ctx.now().toISOString(), body: paid.body };
        ctx.ledger.put(failed);
        return {
          paid: false,
          status: paid.status,
          origin,
          url,
          paymentId,
          amountUsd: submitted.amountUsd,
          receipt: failed,
          body: paid.body,
          error: 'awal payment not accepted',
          code: 'not_settled',
        };
      }
      const settled: Receipt = {
        ...submitted,
        status: 'settled',
        txHash: paid.txHash,
        body: paid.body,
        updatedAt: ctx.now().toISOString(),
      };
      ctx.ledger.put(settled);
      return {
        paid: true,
        status: paid.status,
        origin,
        url,
        paymentId,
        amountUsd: settled.amountUsd,
        txHash: settled.txHash,
        receipt: settled,
        body: paid.body,
      };
    } catch (err) {
      if (err instanceof ClearingError) throw err;
      fail('rail_missing', err instanceof Error ? err.message : 'awal pay failed', 503);
    }
  }
  let payloadB64 = existing?.payloadB64;
  if (!payloadB64) {
    const signed = await ctx.signer.sign({ paymentId, quote });
    payloadB64 = signed.headerValue;
  }
  const createdAt = existing?.createdAt ?? now.toISOString();
  const submitted: Receipt = {
    paymentId,
    chainId: 8453,
    token: 'USDC',
    amountUsd: String(quoteUsd),
    payTo: quote.payTo,
    origin,
    resource: quote.resource || url,
    status: 'submitted',
    payloadB64,
    sessionId: ctx.config.sessionId,
    createdAt,
    updatedAt: now.toISOString(),
  };
  ctx.ledger.put(submitted);

  try {
    const paidRes = await requestOnce({ [V1_PAYMENT_HEADER]: payloadB64, 'PAYMENT-SIGNATURE': payloadB64 });
    const body = await readBody(paidRes);
    if (paidRes.status >= 500) {
      fail('upstream', `paid request failed with ${paidRes.status}`, paidRes.status);
    }
    if (paidRes.status < 200 || paidRes.status >= 300) {
      const failed: Receipt = {
        ...submitted,
        status: 'failed',
        updatedAt: ctx.now().toISOString(),
      };
      ctx.ledger.put(failed);
      return {
        paid: false,
        status: paidRes.status,
        origin,
        url,
        paymentId,
        amountUsd: submitted.amountUsd,
        receipt: failed,
        body,
        quote: paidRes.status === 402 ? body : undefined,
        error: 'payment not accepted',
        code: 'not_settled',
      };
    }
    const settled: Receipt = {
      ...submitted,
      status: 'settled',
      txHash: extractTxHash(body, paidRes.headers) ?? submitted.txHash,
      body,
      updatedAt: ctx.now().toISOString(),
    };
    ctx.ledger.put(settled);
    if (settled.txHash) {
      let from = quote.payTo;
      try {
        const payload = decodePayload(payloadB64);
        if (payload.eip3009?.from) from = payload.eip3009.from;
      } catch {
        /* extract HTTP also records */
      }
      ctx.settlements.add({
        from,
        to: quote.payTo,
        amountUsd: settled.amountUsd,
        at: settled.updatedAt,
        txHash: settled.txHash,
        tag: 'external',
      });
    }
    return {
      paid: true,
      status: paidRes.status,
      origin,
      url,
      paymentId,
      amountUsd: settled.amountUsd,
      txHash: settled.txHash,
      receipt: settled,
      body,
    };
  } catch (err) {
    if (err instanceof ClearingError) throw err;
    const failed: Receipt = { ...submitted, status: 'submitted', updatedAt: ctx.now().toISOString() };
    ctx.ledger.put(failed);
    const replay = err as Error & { settle?: { txHash?: `0x${string}` } };
    return {
      paid: false,
      status: 0,
      origin,
      url,
      paymentId,
      amountUsd: submitted.amountUsd,
      txHash: replay.settle?.txHash,
      receipt: failed,
      error: err instanceof Error ? err.message : 'paid request failed',
      code: 'transport',
    };
  }
}

async function readBody(res: Response): Promise<unknown> {
  const text = await res.text();
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

function extractTxHash(body: unknown, headers: Headers): `0x${string}` | undefined {
  const fromHeader = headers.get('X-PAYMENT-RESPONSE') ?? headers.get('PAYMENT-RESPONSE');
  for (const candidate of [
    fromHeader,
    typeof body === 'object' && body !== null && 'txHash' in body
      ? String((body as { txHash: unknown }).txHash)
      : undefined,
  ]) {
    if (candidate && candidate.startsWith('0x')) return candidate as `0x${string}`;
  }
  return undefined;
}
