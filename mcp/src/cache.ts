import { textHash } from './bytes.js';
import type { ExtractResult } from './types.js';

type Entry = { storedAt: number; result: ExtractResult; ttlSec: number };

export interface ExtractCache {
  getByUrl(finalUrl: string): ExtractResult | undefined;
  put(result: ExtractResult): void;
}

export class MemoryExtractCache implements ExtractCache {
  private readonly byUrl = new Map<string, Entry>();
  private readonly now: () => number;

  constructor(now: () => number = () => Date.now()) {
    this.now = now;
  }

  getByUrl(finalUrl: string): ExtractResult | undefined {
    const entry = this.byUrl.get(finalUrl);
    if (!entry) return undefined;
    if (this.now() - entry.storedAt > entry.ttlSec * 1000) {
      this.byUrl.delete(finalUrl);
      return undefined;
    }
    return { ...entry.result };
  }

  put(result: ExtractResult): void {
    this.byUrl.set(result.finalUrl, {
      storedAt: this.now(),
      ttlSec: result.cacheTtlSec,
      result: { ...result },
    });
  }
}

export function artifactId(finalUrl: string, content: string): string {
  return textHash(`${finalUrl}\n${content}`);
}
