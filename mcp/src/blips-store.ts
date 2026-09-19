/**
 * Settled paid Blip mint ledger — mintIndex source of truth for the escalator.
 * Ownership is the Base NFT (minter / totalSupply), not this file alone.
 */
import { appendFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import type { HexAddress } from './types.js';
import type { BlipMillCard } from './blips-plant.js';

export type BlipMintRow = {
  mintIndex: number;
  tokenId: number;
  ownerWallet: HexAddress;
  mintTx: HexAddress;
  paymentId: string;
  payTx?: HexAddress;
  priceCents: number;
  picture: string;
  brief: string;
  videoUrl?: string;
  imageUrl?: string;
  audioUrl?: string;
  durationSec: number;
  plantVersion: string;
  mill?: BlipMillCard;
  tokenURI: string;
  settledAt: string;
};

export interface BlipsStore {
  count(): number;
  add(row: BlipMintRow): void;
  upsert(row: BlipMintRow): void;
  list(): BlipMintRow[];
  get(mintIndex: number): BlipMintRow | undefined;
  getByPaymentId(paymentId: string): BlipMintRow | undefined;
}

export class MemoryBlipsStore implements BlipsStore {
  protected readonly rows: BlipMintRow[] = [];

  constructor(seed: BlipMintRow[] = []) {
    for (const row of seed) this.rows.push(row);
  }

  count(): number {
    return this.rows.length;
  }

  add(row: BlipMintRow): void {
    if (this.rows.some((r) => r.paymentId === row.paymentId || r.mintIndex === row.mintIndex)) {
      return;
    }
    this.rows.push({ ...row });
  }

  upsert(row: BlipMintRow): void {
    const i = this.rows.findIndex((r) => r.mintIndex === row.mintIndex);
    if (i >= 0) this.rows[i] = { ...row };
    else this.rows.push({ ...row });
  }

  list(): BlipMintRow[] {
    return this.rows.map((r) => ({ ...r }));
  }

  get(mintIndex: number): BlipMintRow | undefined {
    return this.rows.find((r) => r.mintIndex === mintIndex);
  }

  getByPaymentId(paymentId: string): BlipMintRow | undefined {
    if (!paymentId) return undefined;
    return this.rows.find((r) => r.paymentId === paymentId);
  }
}

export class FileBlipsStore extends MemoryBlipsStore {
  constructor(private readonly path: string) {
    super(loadJsonl(path));
  }

  override add(row: BlipMintRow): void {
    const before = this.count();
    super.add(row);
    if (this.count() === before) return;
    mkdirSync(dirname(this.path), { recursive: true });
    appendFileSync(this.path, `${JSON.stringify(row)}\n`, 'utf8');
  }

  override upsert(row: BlipMintRow): void {
    super.upsert(row);
    mkdirSync(dirname(this.path), { recursive: true });
    appendFileSync(this.path, `${JSON.stringify(row)}\n`, 'utf8');
  }
}

/** Collection-scoped ledger so a new mill restarts the escalator at mint 0. */
export function collectionTag(nft?: string): string {
  if (!nft || nft.length < 10) return 'local';
  return nft.slice(2, 10).toLowerCase();
}

export function blipsPath(dataDir: string, nft?: string): string {
  return join(dataDir, `blips-${collectionTag(nft)}.jsonl`);
}

function loadJsonl(path: string): BlipMintRow[] {
  if (!existsSync(path)) return [];
  const byIndex = new Map<number, BlipMintRow>();
  for (const line of readFileSync(path, 'utf8').split('\n')) {
    if (!line.trim()) continue;
    const row = JSON.parse(line) as BlipMintRow;
    byIndex.set(row.mintIndex, row);
  }
  return [...byIndex.values()];
}
