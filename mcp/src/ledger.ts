import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import type { Receipt, ReceiptStatus } from './types.js';
import { parseUsd } from './money.js';

const COUNTED: ReceiptStatus[] = ['submitted', 'settled', 'replayed'];

export interface Ledger {
  get(paymentId: string): Receipt | undefined;
  put(receipt: Receipt): void;
  list(filter?: { since?: string; paymentId?: string; limit?: number }): Receipt[];
  spentUsd(opts: { sessionId?: string; day?: string }): number;
}

export class MemoryLedger implements Ledger {
  private readonly byId = new Map<string, Receipt>();

  constructor(seed: Receipt[] = []) {
    for (const row of seed) this.byId.set(row.paymentId, row);
  }

  get(paymentId: string): Receipt | undefined {
    return this.byId.get(paymentId);
  }

  put(receipt: Receipt): void {
    this.byId.set(receipt.paymentId, { ...receipt });
  }

  list(filter: { since?: string; paymentId?: string; limit?: number } = {}): Receipt[] {
    let rows = [...this.byId.values()].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
    if (filter.paymentId) rows = rows.filter((r) => r.paymentId === filter.paymentId);
    if (filter.since) rows = rows.filter((r) => r.createdAt >= filter.since!);
    if (filter.limit) rows = rows.slice(0, filter.limit);
    return rows.map((r) => ({ ...r }));
  }

  spentUsd(opts: { sessionId?: string; day?: string } = {}): number {
    let total = 0;
    for (const row of this.byId.values()) {
      if (!COUNTED.includes(row.status)) continue;
      if (opts.sessionId && row.sessionId !== opts.sessionId) continue;
      if (opts.day && row.createdAt.slice(0, 10) !== opts.day) continue;
      total += parseUsd(row.amountUsd);
    }
    return total;
  }
}

export class FileLedger extends MemoryLedger {
  constructor(private readonly path: string) {
    super(loadJsonl(path));
  }

  override put(receipt: Receipt): void {
    const existed = this.get(receipt.paymentId);
    super.put(receipt);
    mkdirSync(dirname(this.path), { recursive: true });
    if (!existed) {
      appendFileSync(this.path, `${JSON.stringify(receipt)}\n`, 'utf8');
      return;
    }
    const rows = this.list({}).sort((a, b) => a.createdAt.localeCompare(b.createdAt));
    writeFileSync(this.path, rows.map((r) => JSON.stringify(r)).join('\n') + (rows.length ? '\n' : ''), 'utf8');
  }
}

function loadJsonl(path: string): Receipt[] {
  if (!existsSync(path)) return [];
  const raw = readFileSync(path, 'utf8');
  const rows: Receipt[] = [];
  const byId = new Map<string, Receipt>();
  for (const line of raw.split('\n')) {
    if (!line.trim()) continue;
    const row = JSON.parse(line) as Receipt;
    byId.set(row.paymentId, row);
  }
  for (const row of byId.values()) rows.push(row);
  return rows;
}

export function ledgerPath(dataDir: string): string {
  return join(dataDir, 'receipts.jsonl');
}

export function utcDay(iso: string): string {
  return iso.slice(0, 10);
}
