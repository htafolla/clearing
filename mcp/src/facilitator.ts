import { getAddress } from 'viem';
import { sha256Hex } from './bytes.js';
import { fail } from './errors.js';
import {
  CDP_SETTLE_PATH,
  CDP_VERIFY_PATH,
  CDP_X402_HOST,
  cdpBearerJwt,
  hasCdpKeys,
} from './cdp-auth.js';
import { decodePayload, httpGetBazaar, requirementsMatch } from './x402.js';
import { USDC_EIP712_NAME, USDC_EIP712_VERSION } from './types.js';
import type { Eip3009Auth, FetchFn, HexAddress, PaymentRequirements, PayloadBody } from './types.js';

export type SettleResult = {
  ok: boolean;
  txHash?: HexAddress;
  replayed: boolean;
  error?: string;
};

export interface Facilitator {
  settle(payloadB64: string, expected: PaymentRequirements): Promise<SettleResult>;
  debitCount(): number;
}

export class MemoryFacilitator implements Facilitator {
  private readonly seen = new Map<string, HexAddress>();
  dropAfterSettleOnce = false;
  lastPayload?: string;

  async settle(payloadB64: string, expected: PaymentRequirements): Promise<SettleResult> {
    const body = decodePayload(payloadB64);
    if (!requirementsMatch(body, expected)) {
      return { ok: false, replayed: false, error: 'payload does not match quote' };
    }
    const key = sha256Hex(payloadB64);
    this.lastPayload = payloadB64;
    const existing = this.seen.get(key);
    if (existing) {
      return { ok: true, txHash: existing, replayed: true };
    }
    const txHash = (`0x${key}` as HexAddress);
    this.seen.set(key, txHash);
    if (this.dropAfterSettleOnce) {
      this.dropAfterSettleOnce = false;
      const err = new Error('TCP dropped after facilitator settle');
      (err as Error & { code: string; settle: SettleResult }).code = 'ECONNRESET';
      (err as Error & { code: string; settle: SettleResult }).settle = {
        ok: true,
        txHash,
        replayed: false,
      };
      throw err;
    }
    return { ok: true, txHash, replayed: false };
  }

  debitCount(): number {
    return this.seen.size;
  }
}

export class MissingFacilitator implements Facilitator {
  async settle(): Promise<SettleResult> {
    fail('facilitator_missing', 'no facilitator configured', 503);
  }
  debitCount(): number {
    return 0;
  }
}

export type CdpV2Accepted = {
  scheme: 'exact';
  network: 'eip155:8453';
  asset: string;
  amount: string;
  payTo: string;
  maxTimeoutSeconds: number;
  extra: { name: typeof USDC_EIP712_NAME; version: typeof USDC_EIP712_VERSION };
};

export type CdpSettleBody = {
  x402Version: 2;
  paymentPayload: {
    x402Version: 2;
    accepted: CdpV2Accepted;
    payload: {
      signature: string;
      authorization: {
        from: string;
        to: string;
        value: string;
        validAfter: string;
        validBefore: string;
        nonce: string;
      };
    };
    resource: { url: string; description: string; mimeType: string };
    extensions: { bazaar: ReturnType<typeof httpGetBazaar> };
  };
  paymentRequirements: CdpV2Accepted;
};

/**
 * Bazaar lists the x402 shop (origin + path). Never `/v1/ping`, never railway.app.
 * Query strings are stripped so skim?url= does not mint a row per target.
 */
export function bazaarResourceUrl(shopUrl: string): string | undefined {
  try {
    const u = new URL(shopUrl);
    if (u.protocol !== 'https:') return undefined;
    if (u.hostname.includes('railway.app')) return undefined;
    const path = u.pathname.replace(/\/+$/, '') || '/';
    if (path === '/v1/ping' || path.startsWith('/v1/ping/')) return undefined;
    return `${u.origin}${path === '/' ? '/' : path}`;
  } catch {
    return undefined;
  }
}

export function cdpCatalogResource(expected: PaymentRequirements): string {
  return bazaarResourceUrl(expected.resource) ?? '';
}

export function toCdpSettleBody(body: PayloadBody, expected: PaymentRequirements): CdpSettleBody | { error: string } {
  if (!body.eip3009) return { error: 'missing eip3009 authorization' };
  const auth = body.eip3009;
  let from: string;
  let to: string;
  let payTo: string;
  let asset: string;
  try {
    from = getAddress(auth.from);
    to = getAddress(auth.to);
    payTo = getAddress(expected.payTo);
    asset = getAddress(expected.asset);
  } catch {
    return { error: 'cdp settle needs checksum EVM addresses' };
  }
  const catalog = cdpCatalogResource(expected);
  if (!catalog) return { error: 'bazaar resource must be an x402 shop URL, not /v1/ping' };
  const accepted: CdpV2Accepted = {
    scheme: 'exact',
    network: 'eip155:8453',
    asset,
    amount: expected.maxAmountRequired,
    payTo,
    maxTimeoutSeconds: expected.maxTimeoutSeconds,
    extra: { name: USDC_EIP712_NAME, version: USDC_EIP712_VERSION },
  };
  return {
    x402Version: 2,
    paymentPayload: {
      x402Version: 2,
      accepted,
      payload: {
        signature: auth.signature,
        authorization: {
          from,
          to,
          value: auth.value,
          validAfter: auth.validAfter,
          validBefore: auth.validBefore,
          nonce: auth.nonce,
        },
      },
      resource: {
        url: catalog,
        description: expected.description.slice(0, 500),
        mimeType: expected.mimeType,
      },
      extensions: {
        bazaar: httpGetBazaar({
          queryParams: {},
          querySchema: {},
          requiredQuery: [],
          outputExample: { live: true, status: 402 },
          tags: ['hangar'],
        }),
      },
    },
    paymentRequirements: accepted,
  };
}

export class CdpFacilitator implements Facilitator {
  constructor(
    private readonly opts: {
      apiKeyId?: string;
      apiKeySecret?: string;
      fetchFn?: FetchFn;
    } = {},
  ) {}

  async settle(payloadB64: string, expected: PaymentRequirements): Promise<SettleResult> {
    const body = decodePayload(payloadB64);
    if (!requirementsMatch(body, expected)) {
      return { ok: false, replayed: false, error: 'payload does not match quote' };
    }
    const mapped = toCdpSettleBody(body, expected);
    if ('error' in mapped) {
      return { ok: false, replayed: false, error: mapped.error };
    }
    const verified = await this.cdpPost(CDP_VERIFY_PATH, mapped);
    if (!verified.ok) return verified.settle;
    const json = verified.json as { isValid?: boolean; valid?: boolean; invalidReason?: string };
    if (json.isValid !== true && json.valid !== true) {
      return {
        ok: false,
        replayed: false,
        error: `cdp verify rejected: ${String(json.invalidReason ?? 'invalid').slice(0, 200)}`,
      };
    }
    const settled = await this.cdpPost(CDP_SETTLE_PATH, mapped);
    if (!settled.ok) return settled.settle;
    const out = settled.json as {
      success?: boolean;
      transaction?: string;
      errorReason?: string;
      errorMessage?: string;
    };
    if (out.success === true && typeof out.transaction === 'string' && out.transaction.startsWith('0x')) {
      return { ok: true, txHash: out.transaction as HexAddress, replayed: false };
    }
    return {
      ok: false,
      replayed: false,
      error: `cdp settle failed: ${String(out.errorReason ?? out.errorMessage ?? 'no tx').slice(0, 200)}`,
    };
  }

  debitCount(): number {
    return 0;
  }

  private async cdpPost(
    path: typeof CDP_VERIFY_PATH | typeof CDP_SETTLE_PATH,
    body: CdpSettleBody,
  ): Promise<{ ok: true; json: unknown } | { ok: false; settle: SettleResult }> {
    const apiKeyId = (this.opts.apiKeyId ?? process.env.CDP_API_KEY_ID ?? '').trim();
    const apiKeySecret = (this.opts.apiKeySecret ?? process.env.CDP_API_KEY_SECRET ?? '').trim();
    if (!apiKeyId || !apiKeySecret) {
      return { ok: false, settle: { ok: false, replayed: false, error: 'cdp keys missing' } };
    }
    let jwt: string;
    try {
      jwt = cdpBearerJwt({
        apiKeyId,
        apiKeySecret,
        method: 'POST',
        host: CDP_X402_HOST,
        path,
      });
    } catch {
      return { ok: false, settle: { ok: false, replayed: false, error: 'cdp jwt failed' } };
    }
    const fetchFn = this.opts.fetchFn ?? fetch;
    const label = path.endsWith('/verify') ? 'verify' : 'settle';
    try {
      const res = await fetchFn(`https://${CDP_X402_HOST}${path}`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${jwt}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(15_000),
      });
      const text = await res.text();
      if (!res.ok) {
        return {
          ok: false,
          settle: { ok: false, replayed: false, error: `cdp ${label} ${res.status}: ${text.slice(0, 200)}` },
        };
      }
      try {
        return { ok: true, json: JSON.parse(text) as unknown };
      } catch {
        return { ok: false, settle: { ok: false, replayed: false, error: `cdp ${label} not json` } };
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'fetch failed';
      return { ok: false, settle: { ok: false, replayed: false, error: `cdp ${label} ${msg.slice(0, 200)}` } };
    }
  }
}

/** CDP only when the target is a 402 shop to index. Never ZigZag-settle that nonce. */
export function pingFacilitator(
  fallback: Facilitator,
  fetchFn: FetchFn,
  indexShop = false,
): Facilitator {
  if (!indexShop || !hasCdpKeys()) return fallback;
  return new CdpFacilitator({ fetchFn });
}

export class ZigzagFacilitator implements Facilitator {
  constructor(
    private readonly settleUrl: string,
    private readonly fetchFn: typeof fetch = fetch,
  ) {}

  async settle(payloadB64: string, expected: PaymentRequirements): Promise<SettleResult> {
    const { decodePayload, requirementsMatch } = await import('./x402.js');
    const body = decodePayload(payloadB64);
    if (!requirementsMatch(body, expected)) {
      return { ok: false, replayed: false, error: 'payload does not match quote' };
    }
    if (!body.eip3009) {
      return { ok: false, replayed: false, error: 'missing eip3009 authorization' };
    }
    const token = process.env.CLEARING_RAIL_TOKEN || process.env.ZIGZAG_RAIL_TOKEN;
    const headers: Record<string, string> = { 'content-type': 'application/json' };
    if (token) headers.authorization = `Bearer ${token}`;
    const res = await this.fetchFn(this.settleUrl, {
      method: 'POST',
      headers,
      body: JSON.stringify({ eip3009: body.eip3009 as Eip3009Auth }),
    });
    if (!res.ok) {
      const text = await res.text();
      return { ok: false, replayed: false, error: `zigzag settle ${res.status}: ${text.slice(0, 200)}` };
    }
    const json = (await res.json()) as { txHash?: HexAddress };
    if (!json.txHash || !json.txHash.startsWith('0x')) {
      return { ok: false, replayed: false, error: 'zigzag settle missing txHash' };
    }
    return { ok: true, txHash: json.txHash, replayed: false };
  }

  debitCount(): number {
    return 0;
  }
}

export function createFacilitator(
  kind: 'memory' | 'cdp' | 'none' | 'zigzag',
  allowFake: boolean,
): Facilitator {
  if (kind === 'zigzag') {
    const base = process.env.CLEARING_ZIGZAG_URL || process.env.CLEARING_SIGNER_URL || '';
    const settleUrl =
      process.env.CLEARING_ZIGZAG_SETTLE_URL ||
      (base.endsWith('/sign') ? `${base.slice(0, -5)}/settle` : `${base.replace(/\/$/, '')}/settle`);
    if (!settleUrl || settleUrl === '/settle') {
      fail('facilitator_missing', 'CLEARING_ZIGZAG_URL required for zigzag facilitator', 503);
    }
    return new ZigzagFacilitator(settleUrl);
  }
  if (kind === 'cdp') {
    if (!hasCdpKeys()) fail('facilitator_missing', 'CDP_API_KEY_ID and CDP_API_KEY_SECRET required', 503);
    return new CdpFacilitator();
  }
  if (kind === 'memory') {
    if (!allowFake) fail('facilitator_missing', 'memory facilitator is disabled', 503);
    return new MemoryFacilitator();
  }
  return new MissingFacilitator();
}
