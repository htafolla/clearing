import { sha256Hex } from './bytes.js';
import { fail } from './errors.js';
import { decodePayload, requirementsMatch } from './x402.js';
import type { Eip3009Auth, HexAddress, PaymentRequirements } from './types.js';

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
  if (kind === 'memory') {
    if (!allowFake) fail('facilitator_missing', 'memory facilitator is disabled', 503);
    return new MemoryFacilitator();
  }
  return new MissingFacilitator();
}
