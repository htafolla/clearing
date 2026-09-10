import type { WatchlistItem } from './types.js';

export interface Watchlist {
  list(): WatchlistItem[];
  upsert(item: Omit<WatchlistItem, 'failCount'> & { failCount?: number }): WatchlistItem;
  update(id: string, patch: Partial<WatchlistItem>): WatchlistItem | undefined;
}

export class MemoryWatchlist implements Watchlist {
  private readonly items = new Map<string, WatchlistItem>();

  constructor(seed: WatchlistItem[] = []) {
    for (const item of seed) this.items.set(item.id, { ...item });
  }

  list(): WatchlistItem[] {
    return [...this.items.values()].map((i) => ({ ...i }));
  }

  upsert(item: Omit<WatchlistItem, 'failCount'> & { failCount?: number }): WatchlistItem {
    const existing = this.items.get(item.id);
    const next: WatchlistItem = {
      ...existing,
      ...item,
      id: item.id,
      failCount: item.failCount ?? existing?.failCount ?? 0,
    };
    this.items.set(next.id, next);
    return { ...next };
  }

  update(id: string, patch: Partial<WatchlistItem>): WatchlistItem | undefined {
    const existing = this.items.get(id);
    if (!existing) return undefined;
    const next = { ...existing, ...patch, id };
    this.items.set(id, next);
    return { ...next };
  }
}
