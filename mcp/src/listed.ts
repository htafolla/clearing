/**
 * Hangar board: successful pin settle → public list. No second directory fee.
 */
import { appendFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import type { HexAddress } from './types.js';

export type ListedPin = {
  agentId: number;
  paymentId: string;
  pinnedAt: string;
  tx?: HexAddress;
};

export interface ListedBoard {
  add(row: ListedPin): void;
  list(): ListedPin[];
}

export class MemoryListedBoard implements ListedBoard {
  protected readonly rows: ListedPin[] = [];

  constructor(seed: ListedPin[] = []) {
    for (const row of seed) this.push(row);
  }

  add(row: ListedPin): void {
    this.push(row);
  }

  protected push(row: ListedPin): boolean {
    if (!Number.isInteger(row.agentId) || row.agentId < 0) return false;
    if (!row.paymentId || !row.pinnedAt) return false;
    if (this.rows.some((r) => r.paymentId === row.paymentId)) return false;
    const next: ListedPin = {
      agentId: row.agentId,
      paymentId: row.paymentId,
      pinnedAt: row.pinnedAt,
    };
    if (row.tx) next.tx = row.tx;
    this.rows.push(next);
    return true;
  }

  list(): ListedPin[] {
    const byAgent = new Map<number, ListedPin>();
    for (const row of this.rows) {
      const prev = byAgent.get(row.agentId);
      if (!prev || row.pinnedAt >= prev.pinnedAt) byAgent.set(row.agentId, row);
    }
    return [...byAgent.values()]
      .sort((a, b) => b.pinnedAt.localeCompare(a.pinnedAt) || b.agentId - a.agentId)
      .map((r) => ({ ...r }));
  }
}

export function listedPath(dataDir: string): string {
  return join(dataDir, 'listed.jsonl');
}

export class FileListedBoard extends MemoryListedBoard {
  constructor(private readonly path: string) {
    super(loadListedJsonl(path));
  }

  override add(row: ListedPin): void {
    if (!this.push(row)) return;
    mkdirSync(dirname(this.path), { recursive: true });
    appendFileSync(this.path, `${JSON.stringify(this.rows[this.rows.length - 1])}\n`, 'utf8');
  }
}

function loadListedJsonl(path: string): ListedPin[] {
  if (!existsSync(path)) return [];
  const rows: ListedPin[] = [];
  const seen = new Set<string>();
  for (const line of readFileSync(path, 'utf8').split('\n')) {
    if (!line.trim()) continue;
    try {
      const row = JSON.parse(line) as ListedPin;
      if (!row?.paymentId || typeof row.agentId !== 'number' || !row.pinnedAt) continue;
      if (seen.has(row.paymentId)) continue;
      seen.add(row.paymentId);
      rows.push(row);
    } catch {
      /* skip corrupt line */
    }
  }
  return rows;
}

export function publicListedRow(row: ListedPin): {
  agentId: number;
  pinnedAt: string;
  paymentId: string;
  tx?: HexAddress;
} {
  const out: { agentId: number; pinnedAt: string; paymentId: string; tx?: HexAddress } = {
    agentId: row.agentId,
    pinnedAt: row.pinnedAt,
    paymentId: row.paymentId,
  };
  if (row.tx) out.tx = row.tx;
  return out;
}

export function handleListed(req: Request, board: ListedBoard): Response | undefined {
  const url = new URL(req.url);
  if (url.pathname !== '/v1/listed') return undefined;
  return new Response(JSON.stringify(board.list().map(publicListedRow)), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
}
