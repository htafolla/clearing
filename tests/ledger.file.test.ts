import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { FileLedger, ledgerPath } from '../mcp/src/ledger.js';
import type { Receipt } from '../mcp/src/types.js';

describe('file ledger', () => {
  it('persists and reloads by paymentId', () => {
    const dir = mkdtempSync(join(tmpdir(), 'clearing-ledger-'));
    const path = ledgerPath(dir);
    const a = new FileLedger(path);
    const row: Receipt = {
      paymentId: '11111111-1111-4111-8111-111111111111',
      chainId: 8453,
      token: 'USDC',
      amountUsd: '0.02',
      payTo: '0x0000000000000000000000000000000000000402',
      origin: 'https://api.clearing.dev',
      resource: 'https://api.clearing.dev/v1/extract',
      status: 'settled',
      sessionId: 'sess',
      createdAt: '2026-09-09T00:00:00.000Z',
      updatedAt: '2026-09-09T00:00:00.000Z',
    };
    a.put(row);
    expect(readFileSync(path, 'utf8')).toContain(row.paymentId);
    const b = new FileLedger(path);
    expect(b.get(row.paymentId)?.status).toBe('settled');
    expect(b.spentUsd({ sessionId: 'sess' })).toBe(0.02);
  });
});
