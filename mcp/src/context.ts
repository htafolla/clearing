import { mkdirSync } from 'node:fs';
import { defaultConfig } from './config.js';
import { MemoryExtractCache, type ExtractCache } from './cache.js';
import { FileLedger, MemoryLedger, ledgerPath, type Ledger } from './ledger.js';
import { createFacilitator, MemoryFacilitator, type Facilitator } from './facilitator.js';
import { createSigner, FakeSigner, type Signer } from './signer.js';
import { MemoryWatchlist, type Watchlist } from './watchlist.js';
import { MemorySettlementOracle, type SettlementOracle } from './settlement.js';
import type { ClearingConfig, FetchFn } from './types.js';

export type JsRenderer = (url: string) => Promise<{ html: string; finalUrl: string }>;

export type ClearingContext = {
  config: ClearingConfig;
  now: () => Date;
  fetch: FetchFn;
  signer: Signer;
  facilitator: Facilitator;
  ledger: Ledger;
  cache: ExtractCache;
  watchlist: Watchlist;
  settlements: SettlementOracle;
  renderer?: JsRenderer;
  resolveHost: (hostname: string) => Promise<string[]>;
  liveDiscoverOrigins: () => Set<string>;
  setLiveDiscoverOrigins: (origins: Set<string>) => void;
};

export type ContextOverrides = {
  config?: Partial<ClearingConfig>;
  now?: () => Date;
  fetch?: FetchFn;
  signer?: Signer;
  facilitator?: Facilitator;
  ledger?: Ledger;
  cache?: ExtractCache;
  watchlist?: Watchlist;
  settlements?: SettlementOracle;
  renderer?: JsRenderer;
  resolveHost?: (hostname: string) => Promise<string[]>;
  persist?: boolean;
};

export function createContext(overrides: ContextOverrides = {}): ClearingContext {
  const config = defaultConfig(overrides.config ?? {});
  if (overrides.persist) mkdirSync(config.dataDir, { recursive: true });
  const live = new Set<string>();
  return {
    config,
    now: overrides.now ?? (() => new Date()),
    fetch: overrides.fetch ?? fetch,
    signer:
      overrides.signer ??
      createSigner(config.signer, config.allowFake, {
        signerUrl: process.env.CLEARING_SIGNER_URL,
      }),
    facilitator: overrides.facilitator ?? createFacilitator(config.facilitator, config.allowFake),
    ledger: overrides.ledger ?? (overrides.persist ? new FileLedger(ledgerPath(config.dataDir)) : new MemoryLedger()),
    cache: overrides.cache ?? new MemoryExtractCache(() => Date.now()),
    watchlist: overrides.watchlist ?? new MemoryWatchlist(),
    settlements: overrides.settlements ?? new MemorySettlementOracle(),
    renderer: overrides.renderer,
    resolveHost: overrides.resolveHost ?? (async (hostname) => {
      const { promises: dns } = await import('node:dns');
      const records = await dns.lookup(hostname, { all: true });
      return records.map((r) => r.address);
    }),
    liveDiscoverOrigins: () => live,
    setLiveDiscoverOrigins: (origins) => {
      live.clear();
      for (const o of origins) live.add(o);
    },
  };
}

export function isFakeStack(ctx: ClearingContext): boolean {
  return ctx.signer instanceof FakeSigner && ctx.facilitator instanceof MemoryFacilitator;
}
