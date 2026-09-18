import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { withMintLock } from '../mcp/src/mint-lock.js';

describe('withMintLock', () => {
  it('runs one mill at a time', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'mint-lock-'));
    const order: number[] = [];
    await Promise.all([
      withMintLock(dir, async () => {
        order.push(1);
        await new Promise((r) => setTimeout(r, 30));
        order.push(2);
      }),
      withMintLock(dir, async () => {
        order.push(3);
        order.push(4);
      }),
    ]);
    expect(order).toEqual([1, 2, 3, 4]);
    rmSync(dir, { recursive: true, force: true });
  });
});
