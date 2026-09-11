import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { FileLedger } from '../mcp/src/ledger.js';
import { FileSettlementOracle } from '../mcp/src/settlement.js';
import { createContext } from '../mcp/src/context.js';

describe('settlement persistence', () => {
  it('does not duplicate txHash', () => {
    const path = join(mkdtempSync(join(tmpdir(), 'set-')), 's.jsonl');
    const oracle = new FileSettlementOracle(path);
    const row = {
      from: '0x00552afc18275c7723dad2EC95d77308738cE07e' as const,
      to: '0xc9cD4E19e8fFabFC479352680295ba12e454462D' as const,
      amountUsd: '0.02',
      at: new Date().toISOString(),
      txHash: '0x568fc108b0d70b9ca7f3686182391d7056f11cb581cf4ac19f448a1af798981c' as const,
      tag: 'external' as const,
    };
    oracle.add(row);
    oracle.add(row);
    expect(oracle.transfersTo(row.to, '1970-01-01T00:00:00.000Z')).toHaveLength(1);
    const reloaded = new FileSettlementOracle(path);
    expect(reloaded.transfersTo(row.to, '1970-01-01T00:00:00.000Z')).toHaveLength(1);
  });

  it('hydrates from settled ledger receipts when settlement file is empty', () => {
    const dir = mkdtempSync(join(tmpdir(), 'led-'));
    const ledger = new FileLedger(join(dir, 'receipts.jsonl'));
    ledger.put({
      paymentId: 'p1',
      chainId: 8453,
      token: 'USDC',
      amountUsd: '0.02',
      payTo: '0xc9cD4E19e8fFabFC479352680295ba12e454462D',
      origin: 'https://clearing-production-9968.up.railway.app',
      resource: 'https://clearing-production-9968.up.railway.app/v1/extract',
      status: 'settled',
      sessionId: 's',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      txHash: '0x568fc108b0d70b9ca7f3686182391d7056f11cb581cf4ac19f448a1af798981c',
    });
    const ctx = createContext({
      persist: true,
      ledger,
      config: {
        dataDir: dir,
        payTo: '0xc9cD4E19e8fFabFC479352680295ba12e454462D',
        allowFake: true,
        signer: 'fake',
        facilitator: 'memory',
      },
    });
    expect(
      ctx.settlements.transfersTo('0xc9cD4E19e8fFabFC479352680295ba12e454462D', '1970-01-01T00:00:00.000Z').length,
    ).toBeGreaterThan(0);
  });
});
