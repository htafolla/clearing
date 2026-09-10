import { sha256Hex } from './bytes.js';
import { fail } from './errors.js';
import { decodePayload, requirementsMatch } from './x402.js';
import type { HexAddress, PaymentRequirements } from './types.js';

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

export function createFacilitator(kind: 'memory' | 'cdp' | 'none', allowFake: boolean): Facilitator {
  if (kind === 'memory') {
    if (!allowFake) fail('facilitator_missing', 'memory facilitator is disabled', 503);
    return new MemoryFacilitator();
  }
  return new MissingFacilitator();
}
