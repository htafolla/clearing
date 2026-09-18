/**
 * Exclusive lock so two hangar workers cannot mill mintIndex N at once.
 * Uses dataDir (Railway volume) so replicas share the lock.
 */
import { closeSync, existsSync, mkdirSync, openSync, statSync, unlinkSync, writeSync } from 'node:fs';
import { constants } from 'node:fs';
import { join } from 'node:path';

const STALE_MS = 3 * 60 * 1000;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function withMintLock<T>(dataDir: string, fn: () => Promise<T>): Promise<T> {
  mkdirSync(dataDir, { recursive: true });
  const path = join(dataDir, 'blip-mint.lock');
  const started = Date.now();
  for (;;) {
    try {
      const fd = openSync(path, constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY);
      try {
        writeSync(fd, `${process.pid} ${new Date().toISOString()}\n`);
      } finally {
        closeSync(fd);
      }
      try {
        return await fn();
      } finally {
        try {
          unlinkSync(path);
        } catch {
          /* lock already gone */
        }
      }
    } catch (err) {
      const code = err && typeof err === 'object' && 'code' in err ? String((err as { code: unknown }).code) : '';
      if (code !== 'EEXIST') throw err;
      if (existsSync(path)) {
        const age = Date.now() - statSync(path).mtimeMs;
        if (age > STALE_MS) {
          try {
            unlinkSync(path);
          } catch {
            /* raced */
          }
          continue;
        }
      }
      if (Date.now() - started > STALE_MS) {
        throw new Error('blip mint lock timeout');
      }
      await sleep(50);
    }
  }
}
