import { randomUUID } from 'node:crypto';
import { createContext, type ClearingContext, type ContextOverrides } from '../mcp/src/context.js';
import { handleHangar } from '../mcp/src/http.js';
import { createFacilitator, MemoryFacilitator } from '../mcp/src/facilitator.js';
import { createSigner, FakeSigner } from '../mcp/src/signer.js';
import { MemoryWatchlist } from '../mcp/src/watchlist.js';
import { MemorySettlementOracle } from '../mcp/src/settlement.js';
import type { ClearingConfig, FetchFn, WatchlistItem } from '../mcp/src/types.js';

export const EXAMPLE_HTML = `<!doctype html><html><head><title>Example Domain</title></head><body><h1>Example Domain</h1><p>This domain is for use in documentation examples.</p></body></html>`;

export const PAY_TO = '0x0000000000000000000000000000000000000402' as const;
export const PAYER_A = '0x0000000000000000000000000000000000000a01' as const;
export const PAYER_B = '0x0000000000000000000000000000000000000b02' as const;

export function urlOf(input: string | URL | Request): string {
  if (typeof input === 'string') return input;
  if (input instanceof URL) return input.toString();
  return input.url;
}

export type Page = {
  status?: number;
  headers?: Record<string, string>;
  body: string;
  contentType?: string;
};

export function pagesFetch(pages: Record<string, Page>, opts?: { record?: string[] }): FetchFn {
  const record = opts?.record;
  return async (input) => {
    const raw = urlOf(input);
    record?.push(raw);
    const url = new URL(raw);
    const byPath = pages[raw] ?? pages[`${url.origin}${url.pathname}`];
    if (url.pathname === '/robots.txt' && !byPath) {
      return new Response('', { status: 404 });
    }
    const page = byPath;
    if (!page) {
      return new Response('not found', { status: 404 });
    }
    return new Response(page.body, {
      status: page.status ?? 200,
      headers: {
        'Content-Type': page.contentType ?? (url.pathname.endsWith('.json') ? 'application/json' : 'text/html'),
        ...page.headers,
      },
    });
  };
}

export function withExtractLoopback(base: FetchFn, ctx: ClearingContext): FetchFn {
  return async (input, init) => {
    const raw = urlOf(input);
    const url = new URL(raw);
    const extractHost = new URL(ctx.config.extractBaseUrl).host;
    if (url.host === extractHost || url.hostname === 'api.clearing.dev') {
      const headers = new Headers(init?.headers);
      if (input instanceof Request) {
        input.headers.forEach((v, k) => {
          if (!headers.has(k)) headers.set(k, v);
        });
      }
      const req = new Request(raw, {
        method: init?.method ?? (input instanceof Request ? input.method : 'GET'),
        headers,
      });
      return handleHangar(req, ctx);
    }
    return base(input, init);
  };
}

export function makeCtx(
  pages: Record<string, Page> = {},
  extra: ContextOverrides & { config?: Partial<ClearingConfig> } = {},
): ClearingContext {
  const allowFake = extra.config?.allowFake !== false;
  const signer =
    extra.signer ??
    (allowFake ? new FakeSigner() : createSigner(extra.config?.signer ?? 'x402_fetch', false));
  const facilitator =
    extra.facilitator ??
    (allowFake ? new MemoryFacilitator() : createFacilitator(extra.config?.facilitator ?? 'none', allowFake));
  const ctx = createContext({
    ...extra,
    config: {
      allowFake,
      signer: extra.config?.signer ?? (allowFake ? 'fake' : 'x402_fetch'),
      facilitator: extra.config?.facilitator ?? (allowFake ? 'memory' : 'none'),
      payTo: PAY_TO,
      extractBaseUrl: 'https://api.clearing.dev',
      sessionId: randomUUID(),
      ...extra.config,
    },
    signer,
    facilitator,
    resolveHost: extra.resolveHost ?? (async () => ['203.0.113.10']),
  });
  const base =
    extra.fetch ??
    pagesFetch({
      'https://example.com/': { body: EXAMPLE_HTML },
      'https://example.com': { body: EXAMPLE_HTML },
      'https://example.com/robots.txt': { body: 'User-agent: *\nAllow: /\n', status: 200 },
      ...pages,
    });
  ctx.fetch = withExtractLoopback(base, ctx);
  return ctx;
}

export function liveExtractWatchItem(): WatchlistItem {
  return {
    id: 'extract-self',
    origin: 'https://api.clearing.dev',
    url: 'https://api.clearing.dev/v1/extract?url=https://example.com',
    category: 'extract',
    cardUrl: 'https://api.clearing.dev/.well-known/agent.json',
    failCount: 0,
  };
}

export function seedLiveExtract(ctx: ClearingContext): void {
  const watch = ctx.watchlist as MemoryWatchlist;
  watch.upsert(liveExtractWatchItem());
  const oracle = ctx.settlements as MemorySettlementOracle;
  const now = ctx.now().toISOString();
  oracle.add({
    from: PAYER_A,
    to: PAY_TO,
    amountUsd: '0.02',
    at: now,
    txHash: '0xabc1abc1abc1abc1abc1abc1abc1abc1abc1abc1abc1abc1abc1abc1abc1abc1',
    tag: 'external',
  });
  oracle.add({
    from: PAYER_B,
    to: PAY_TO,
    amountUsd: '0.02',
    at: now,
    txHash: '0xabc2abc2abc2abc2abc2abc2abc2abc2abc2abc2abc2abc2abc2abc2abc2abc2',
    tag: 'external',
  });
}
