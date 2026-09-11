import { appendFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { join } from 'node:path';
import { normalizeAddress } from './bytes.js';
import type { HexAddress, Transfer } from './types.js';

export interface SettlementOracle {
  transfersTo(payTo: HexAddress, sinceIso: string): Transfer[];
  add(transfer: Transfer): void;
}

export class MemorySettlementOracle implements SettlementOracle {
  constructor(private readonly rows: Transfer[] = []) {}

  has(txHash: string): boolean {
    const needle = txHash.toLowerCase();
    return this.rows.some((row) => row.txHash.toLowerCase() === needle);
  }

  add(transfer: Transfer): void {
    if (this.has(transfer.txHash)) return;
    this.rows.push({
      ...transfer,
      from: normalizeAddress(transfer.from),
      to: normalizeAddress(transfer.to),
    });
  }

  transfersTo(payTo: HexAddress, sinceIso: string): Transfer[] {
    const to = normalizeAddress(payTo);
    return this.rows.filter((row) => normalizeAddress(row.to) === to && row.at >= sinceIso);
  }
}

export function daysAgoIso(now: Date, days: number): string {
  return new Date(now.getTime() - days * 24 * 60 * 60 * 1000).toISOString();
}

export function settlementPath(dataDir: string): string {
  return join(dataDir, 'settlements.jsonl');
}

export class FileSettlementOracle extends MemorySettlementOracle {
  constructor(private readonly path: string) {
    super(loadSettlementJsonl(path));
  }

  override add(transfer: Transfer): void {
    if (this.has(transfer.txHash)) return;
    const stored: Transfer = {
      ...transfer,
      from: normalizeAddress(transfer.from),
      to: normalizeAddress(transfer.to),
    };
    super.add(stored);
    mkdirSync(dirname(this.path), { recursive: true });
    appendFileSync(this.path, `${JSON.stringify(stored)}\n`, 'utf8');
  }
}

function loadSettlementJsonl(path: string): Transfer[] {
  if (!existsSync(path)) return [];
  const byHash = new Map<string, Transfer>();
  for (const line of readFileSync(path, 'utf8').split('\n')) {
    if (!line.trim()) continue;
    try {
      const row = JSON.parse(line) as Transfer;
      if (!row?.txHash || !row.to || !row.from) continue;
      byHash.set(row.txHash.toLowerCase(), {
        ...row,
        from: normalizeAddress(row.from),
        to: normalizeAddress(row.to),
      });
    } catch {
      /* skip corrupt line */
    }
  }
  return [...byHash.values()];
}
