/**
 * Hangar board: successful pin settle → public list. No second directory fee.
 * Online/certified: Groover + Dynamo solar + live MCP/store + health ok within N minutes.
 * N = probeIntervalMs (default 15 minutes).
 */
import { appendFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { probeLiveHttps, type LiveShopCtx } from './live-shop.js';
import type { HexAddress } from './types.js';

export type ListedPin = {
  agentId: number;
  paymentId: string;
  pinnedAt: string;
  tx?: HexAddress;
  mcpUrl?: string;
  storeUrl?: string;
  liveAt?: string;
  groover?: string;
  solar?: string;
  healthAt?: string;
};

export type PublicListedRow = {
  agentId: number;
  pinnedAt: string;
  paymentId: string;
  tx?: HexAddress;
  mcpUrl?: string;
  storeUrl?: string;
  liveAt?: string;
  groover?: string;
  solar?: string;
  healthAt?: string;
  live: true;
};

export interface ListedBoard {
  add(row: ListedPin): void;
  list(): ListedPin[];
  touchHealth(agentId: number, healthAt: string): void;
}

export type ListedHttpCtx = LiveShopCtx & {
  listed: ListedBoard;
  config: LiveShopCtx['config'] & { probeIntervalMs: number };
};

export class MemoryListedBoard implements ListedBoard {
  protected readonly rows: ListedPin[] = [];

  constructor(seed: ListedPin[] = []) {
    for (const row of seed) this.push(row);
  }

  add(row: ListedPin): void {
    this.push(row);
  }

  touchHealth(agentId: number, healthAt: string): void {
    let latest: ListedPin | undefined;
    for (const row of this.rows) {
      if (row.agentId !== agentId) continue;
      if (!latest || row.pinnedAt >= latest.pinnedAt) latest = row;
    }
    if (latest) latest.healthAt = healthAt;
  }

  protected push(row: ListedPin): boolean {
    if (!Number.isInteger(row.agentId) || row.agentId < 0) return false;
    if (!row.paymentId || !row.pinnedAt) return false;
    if (!row.mcpUrl && !row.storeUrl) return false;
    if (!row.groover || !row.solar) return false;
    if (this.rows.some((r) => r.paymentId === row.paymentId)) return false;
    const next: ListedPin = {
      agentId: row.agentId,
      paymentId: row.paymentId,
      pinnedAt: row.pinnedAt,
      groover: row.groover,
      solar: row.solar,
    };
    if (row.tx) next.tx = row.tx;
    if (row.mcpUrl) next.mcpUrl = row.mcpUrl;
    if (row.storeUrl) next.storeUrl = row.storeUrl;
    if (row.liveAt) next.liveAt = row.liveAt;
    next.healthAt = row.healthAt ?? row.liveAt ?? row.pinnedAt;
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

export function publicListedRow(row: ListedPin): PublicListedRow {
  const out: PublicListedRow = {
    agentId: row.agentId,
    pinnedAt: row.pinnedAt,
    paymentId: row.paymentId,
    live: true,
  };
  if (row.tx) out.tx = row.tx;
  if (row.mcpUrl) out.mcpUrl = row.mcpUrl;
  if (row.storeUrl) out.storeUrl = row.storeUrl;
  if (row.liveAt) out.liveAt = row.liveAt;
  if (row.groover) out.groover = row.groover;
  if (row.solar) out.solar = row.solar;
  if (row.healthAt) out.healthAt = row.healthAt;
  return out;
}

export function isHealthFresh(healthAt: string | undefined, now: Date, windowMs: number): boolean {
  if (!healthAt) return false;
  const at = Date.parse(healthAt);
  if (!Number.isFinite(at)) return false;
  return now.getTime() - at <= windowMs;
}

export async function handleListed(req: Request, ctx: ListedHttpCtx): Promise<Response | undefined> {
  const url = new URL(req.url);
  if (url.pathname !== '/v1/listed' && url.pathname !== '/v1/online') return undefined;
  const windowMs = ctx.config.probeIntervalMs;
  const now = ctx.now();
  const rows: PublicListedRow[] = [];
  for (const row of ctx.listed.list()) {
    const live = await onlineRow(row, ctx, now, windowMs);
    if (live) rows.push(live);
  }
  return new Response(JSON.stringify(rows), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
}

async function onlineRow(
  row: ListedPin,
  ctx: ListedHttpCtx,
  now: Date,
  windowMs: number,
): Promise<PublicListedRow | undefined> {
  if (!row.groover || !row.solar) return undefined;
  if (!row.mcpUrl && !row.storeUrl) return undefined;
  if (isHealthFresh(row.healthAt, now, windowMs)) return publicListedRow(row);
  const urls = [row.mcpUrl, row.storeUrl].filter((u): u is string => Boolean(u));
  for (const shop of urls) {
    if (await probeLiveHttps(shop, ctx)) {
      const healthAt = now.toISOString();
      ctx.listed.touchHealth(row.agentId, healthAt);
      return publicListedRow({ ...row, healthAt });
    }
  }
  return undefined;
}
