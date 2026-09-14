export const BASE_CHAIN_ID = 8453;
export const USDC_BASE = '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913' as const;
export const IDENTITY_REGISTRY = '0x8004A169FB4a3325136EB29fA0ceB6D2e539a432' as const;
export const USDC_DECIMALS = 6;
export const ALWAYS_ALLOW_ORIGIN = 'api.clearing.dev';

export type HexAddress = `0x${string}`;
export type SignerKind = 'q402' | 'circle' | 'coinbase' | 'awal' | 'x402_fetch' | 'fake' | 'zigzag';
export type FacilitatorKind = 'memory' | 'cdp' | 'none' | 'zigzag';
export type ReceiptStatus = 'quoted' | 'submitted' | 'settled' | 'failed' | 'replayed';
export type DiscoverCategory = 'extract' | 'api' | 'mcp';

export type ClearingConfig = {
  chainId: typeof BASE_CHAIN_ID;
  usdc: typeof USDC_BASE;
  payTo: HexAddress;
  signer: SignerKind;
  facilitator: FacilitatorKind;
  allowFake: boolean;
  perTxCapUsd: number;
  sessionCapUsd: number;
  dailyCapUsd: number;
  confirmAboveUsd: number;
  allowOrigins: string[];
  extractPriceUsd: number;
  extractPriceJsUsd: number;
  extractBaseUrl: string;
  extractPort: number;
  discoverMinSettlements7d: number;
  probeTimeoutMs: number;
  probeIntervalMs: number;
  cacheTtlSec: number;
  maxChars: number;
  fetchTimeoutMs: number;
  dataDir: string;
  sessionId: string;
  soakFromAddresses: HexAddress[];
  sessionToken?: string;
  /** Friend-test pin backfill. Rows without live URL + Groover + solar are ignored. */
  listedSeed: ListedSeed[];
};

export type ListedSeed = {
  agentId: number;
  mcpUrl?: string;
  storeUrl?: string;
  groover?: string;
  solar?: string;
};

export type Receipt = {
  paymentId: string;
  txHash?: HexAddress;
  chainId: typeof BASE_CHAIN_ID;
  token: 'USDC';
  amountUsd: string;
  payTo: HexAddress;
  origin: string;
  resource: string;
  status: ReceiptStatus;
  payloadB64?: string;
  body?: unknown;
  sessionId: string;
  createdAt: string;
  updatedAt: string;
};

export type PaymentRequirements = {
  scheme: 'exact';
  network: 'eip155:8453';
  maxAmountRequired: string;
  asset: typeof USDC_BASE;
  payTo: HexAddress;
  resource: string;
  description: string;
  mimeType: 'application/json';
  maxTimeoutSeconds: number;
  extra: { name: 'USDC'; version: '2' };
};

/** x402 v2 PaymentRequired. `accepts[]` keeps v1 fields so ZigZag still signs EIP-3009. */
export type BazaarExtension = {
  info: {
    input: {
      type: 'http';
      method: 'GET';
      queryParams?: Record<string, string>;
    };
    output?: {
      type: 'json';
      example: Record<string, unknown>;
    };
  };
  schema: {
    $schema: 'https://json-schema.org/draft/2020-12/schema';
    type: 'object';
    properties: Record<string, unknown>;
    required: ['input'];
  };
};

export type X402Quote = {
  x402Version: 2;
  error: string;
  resource: {
    url: string;
    description: string;
    mimeType: 'application/json';
    serviceName: string;
    tags?: string[];
  };
  accepts: Array<PaymentRequirements & { amount: string }>;
  extensions: { bazaar: BazaarExtension };
};

export type SignedPayment = {
  paymentId: string;
  headerName: 'X-PAYMENT' | 'PAYMENT-SIGNATURE';
  headerValue: string;
  payloadBytes: Uint8Array;
  nonce: string;
  quote: PaymentRequirements;
};

export type Eip3009Auth = {
  from: HexAddress;
  to: HexAddress;
  value: string;
  validAfter: string;
  validBefore: string;
  nonce: `0x${string}`;
  signature: `0x${string}`;
};

export type PayloadBody = {
  x402Version: 1;
  paymentId: string;
  nonce: string;
  accepted: PaymentRequirements;
  eip3009?: Eip3009Auth;
};

export type ExtractResult = {
  url: string;
  finalUrl: string;
  title: string;
  markdown: string;
  textHash: string;
  fetchedAt: string;
  cacheTtlSec: number;
  bytes: number;
  blocked: boolean;
  reason?: string;
  paid?: boolean;
  txHash?: HexAddress;
  httpStatus?: number;
  contentType?: string;
  bodySha256?: string;
  bodyBytes?: number;
  replayed?: boolean;
};

export type WatchlistItem = {
  id: string;
  origin: string;
  url: string;
  category: DiscoverCategory;
  cardUrl?: string;
  erc8004Id?: string;
  failCount: number;
  lastProbeAt?: string;
  lastProbeOk?: boolean;
  lastLatencyMs?: number;
};

export type DiscoveredService = {
  origin: string;
  url: string;
  category: DiscoverCategory;
  payTo: HexAddress;
  asset: typeof USDC_BASE;
  amountUsd: string;
  settlements7d: number;
  probeLatencyMs: number;
  thinLiquidity: boolean;
};

export type Transfer = {
  from: HexAddress;
  to: HexAddress;
  amountUsd: string;
  at: string;
  txHash: HexAddress;
  tag?: 'soak' | 'external';
};

export type FetchFn = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;
