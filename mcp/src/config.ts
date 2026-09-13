import { homedir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { fail } from './errors.js';
import { isHexAddress, normalizeAddress } from './bytes.js';
import {
  ALWAYS_ALLOW_ORIGIN,
  BASE_CHAIN_ID,
  USDC_BASE,
  type ClearingConfig,
  type HexAddress,
  type SignerKind,
} from './types.js';

const SIGNERS: SignerKind[] = ['q402', 'circle', 'coinbase', 'awal', 'x402_fetch', 'fake', 'zigzag'];

function env(name: string): string | undefined {
  const v = process.env[name];
  return v && v.length > 0 ? v : undefined;
}

function envNumber(name: string, fallback: number): number {
  const raw = env(name);
  if (raw === undefined) return fallback;
  const n = Number(raw);
  if (!Number.isFinite(n)) fail('config', `${name} is not a number`);
  return n;
}

function envBool(name: string, fallback: boolean): boolean {
  const raw = env(name);
  if (raw === undefined) return fallback;
  return raw === '1' || raw.toLowerCase() === 'true';
}

export function defaultConfig(overrides: Partial<ClearingConfig> = {}): ClearingConfig {
  const extractBaseUrl = overrides.extractBaseUrl ?? env('CLEARING_EXTRACT_BASE_URL') ?? 'http://127.0.0.1:8787';
  let extractHost: string | undefined;
  try {
    extractHost = new URL(extractBaseUrl).host;
  } catch {
    extractHost = undefined;
  }
  const allowOrigins = new Set<string>([
    ALWAYS_ALLOW_ORIGIN,
    ...(extractHost ? [extractHost, new URL(extractBaseUrl).hostname] : []),
    ...(overrides.allowOrigins ?? []),
  ]);
  const extra = env('CLEARING_ALLOW_ORIGINS');
  if (extra) {
    for (const part of extra.split(',')) {
      const trimmed = part.trim();
      if (trimmed) allowOrigins.add(trimmed);
    }
  }

  const signerRaw = (overrides.signer ?? env('CLEARING_SIGNER') ?? 'x402_fetch') as SignerKind;
  if (!SIGNERS.includes(signerRaw)) {
    fail('config', `unknown signer ${signerRaw}`);
  }

  const allowFake = overrides.allowFake ?? envBool('CLEARING_ALLOW_FAKE', false);
  const payToRaw = overrides.payTo ?? env('CLEARING_PAY_TO');
  if (!payToRaw) {
    if (!allowFake) fail('config', 'CLEARING_PAY_TO is required when fake rails are disabled');
  }
  const payToResolved = payToRaw ?? '0x0000000000000000000000000000000000000402';
  if (!isHexAddress(payToResolved)) fail('config', 'CLEARING_PAY_TO must be a 20-byte hex address');
  const facilitator =
    overrides.facilitator ??
    (env('CLEARING_FACILITATOR') as import('./types.js').FacilitatorKind | undefined) ??
    (signerRaw === 'zigzag' ? 'zigzag' : allowFake ? 'memory' : 'none');

  const soak = (overrides.soakFromAddresses ?? []).slice();
  const soakEnv = env('CLEARING_SOAK_FROM');
  if (soakEnv) {
    for (const part of soakEnv.split(',')) {
      if (isHexAddress(part.trim())) soak.push(normalizeAddress(part.trim()));
    }
  }

  return {
    chainId: BASE_CHAIN_ID,
    usdc: USDC_BASE,
    payTo: normalizeAddress(payToResolved),
    signer: signerRaw,
    facilitator,
    allowFake,
    perTxCapUsd: overrides.perTxCapUsd ?? envNumber('CLEARING_PER_TX_CAP_USD', 2),
    sessionCapUsd: overrides.sessionCapUsd ?? envNumber('CLEARING_SESSION_CAP_USD', 5),
    dailyCapUsd: overrides.dailyCapUsd ?? envNumber('CLEARING_DAILY_CAP_USD', 5),
    confirmAboveUsd: overrides.confirmAboveUsd ?? envNumber('CLEARING_CONFIRM_ABOVE_USD', 1),
    allowOrigins: [...allowOrigins],
    extractPriceUsd: overrides.extractPriceUsd ?? envNumber('CLEARING_EXTRACT_PRICE_USD', 0.02),
    extractPriceJsUsd: overrides.extractPriceJsUsd ?? envNumber('CLEARING_EXTRACT_PRICE_JS_USD', 0.05),
    extractBaseUrl: extractBaseUrl.replace(/\/$/, ''),
    extractPort: overrides.extractPort ?? envNumber('CLEARING_EXTRACT_PORT', 8787),
    discoverMinSettlements7d: overrides.discoverMinSettlements7d ?? envNumber('CLEARING_DISCOVER_MIN_SETTLEMENTS_7D', 1),
    probeTimeoutMs: overrides.probeTimeoutMs ?? envNumber('CLEARING_PROBE_TIMEOUT_MS', 4000),
    probeIntervalMs: overrides.probeIntervalMs ?? envNumber('CLEARING_PROBE_INTERVAL_MS', 15 * 60 * 1000),
    cacheTtlSec: overrides.cacheTtlSec ?? envNumber('CLEARING_CACHE_TTL_SEC', 3600),
    maxChars: overrides.maxChars ?? envNumber('CLEARING_MAX_CHARS', 200_000),
    fetchTimeoutMs: overrides.fetchTimeoutMs ?? envNumber('CLEARING_FETCH_TIMEOUT_MS', 20_000),
    dataDir: overrides.dataDir ?? env('CLEARING_DATA_DIR') ?? join(homedir(), '.clearing'),
    sessionId: overrides.sessionId ?? env('CLEARING_SESSION_ID') ?? randomUUID(),
    soakFromAddresses: soak,
    sessionToken: overrides.sessionToken ?? env('CLEARING_SESSION_TOKEN'),
    listedSeed: overrides.listedSeed ?? defaultListedSeed(),
  };
}

/** Blinky 86556 and friend 86666 — hosted hangar board seed when env is unset. */
const HOSTED_LISTED_SEED = [86556, 86666];

function defaultListedSeed(): number[] {
  const raw = env('CLEARING_LISTED_SEED');
  if (raw !== undefined) return parseListedSeed(raw);
  if (process.env.RAILWAY_ENVIRONMENT) return HOSTED_LISTED_SEED;
  return [];
}

export function parseListedSeed(raw: string): number[] {
  const ids: number[] = [];
  const seen = new Set<number>();
  for (const part of raw.split(',')) {
    const n = Number.parseInt(part.trim(), 10);
    if (!Number.isInteger(n) || n < 0 || seen.has(n)) continue;
    seen.add(n);
    ids.push(n);
  }
  return ids;
}

export function maskAddress(addr: HexAddress): string {
  return `${addr.slice(0, 6)}…${addr.slice(-4)}`;
}

export function assertConfirmCapLive(config: ClearingConfig): void {
  if (config.confirmAboveUsd > config.perTxCapUsd) {
    fail(
      'config',
      `confirmAboveUsd (${config.confirmAboveUsd}) must be <= perTxCapUsd (${config.perTxCapUsd}) so Plan Mode can fire`,
    );
  }
}
