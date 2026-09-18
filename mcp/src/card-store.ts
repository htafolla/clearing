import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';

export type StoredCard = {
  id: string;
  json: unknown;
  from?: string;
  agentId?: number;
  createdAt: string;
};

export interface CardStore {
  put(json: unknown, from?: string): StoredCard;
  get(id: string): StoredCard | undefined;
  listFrom(from: string): StoredCard[];
  attachAgent(id: string, agentId: number): void;
}

export class MemoryCardStore implements CardStore {
  private readonly rows: StoredCard[] = [];

  put(json: unknown, from?: string): StoredCard {
    const row: StoredCard = {
      id: randomUUID().slice(0, 8),
      json,
      createdAt: new Date().toISOString(),
      ...(from ? { from: from.toLowerCase() } : {}),
    };
    this.rows.push(row);
    return row;
  }

  get(id: string): StoredCard | undefined {
    return this.rows.find((r) => r.id === id);
  }

  listFrom(from: string): StoredCard[] {
    const want = from.toLowerCase();
    return this.rows.filter((r) => r.from === want);
  }

  attachAgent(id: string, agentId: number): void {
    const row = this.get(id);
    if (row) row.agentId = agentId;
  }
}

export function cardsPath(dataDir: string): string {
  return join(dataDir, 'cards');
}

export class FileCardStore extends MemoryCardStore {
  constructor(private readonly dir: string) {
    super();
    if (existsSync(dir)) {
      /* lazy reads via get overwrite — keep memory for this process; persist on put */
    }
    mkdirSync(dir, { recursive: true });
  }

  override put(json: unknown, from?: string): StoredCard {
    const row = super.put(json, from);
    mkdirSync(this.dir, { recursive: true });
    writeFileSync(join(this.dir, `${row.id}.json`), JSON.stringify(row.json), 'utf8');
    writeFileSync(join(this.dir, `${row.id}.meta.json`), JSON.stringify(row), 'utf8');
    return row;
  }

  override get(id: string): StoredCard | undefined {
    const mem = super.get(id);
    if (mem) return mem;
    const meta = join(this.dir, `${id}.meta.json`);
    if (!existsSync(meta)) return undefined;
    try {
      return JSON.parse(readFileSync(meta, 'utf8')) as StoredCard;
    } catch {
      return undefined;
    }
  }
}
