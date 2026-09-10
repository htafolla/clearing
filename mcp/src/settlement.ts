import { normalizeAddress } from './bytes.js';
import type { HexAddress, Transfer } from './types.js';

export interface SettlementOracle {
  transfersTo(payTo: HexAddress, sinceIso: string): Transfer[];
  add(transfer: Transfer): void;
}

export class MemorySettlementOracle implements SettlementOracle {
  constructor(private readonly rows: Transfer[] = []) {}

  add(transfer: Transfer): void {
    this.rows.push({
      ...transfer,
      from: normalizeAddress(transfer.from),
      to: normalizeAddress(transfer.to),
    });
  }

  transfersTo(payTo: HexAddress, sinceIso: string): Transfer[] {
    const to = normalizeAddress(payTo);
    return this.rows.filter((row) => row.to === to && row.at >= sinceIso);
  }
}

export function daysAgoIso(now: Date, days: number): string {
  return new Date(now.getTime() - days * 24 * 60 * 60 * 1000).toISOString();
}
