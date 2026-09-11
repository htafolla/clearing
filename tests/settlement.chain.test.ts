import { describe, expect, it } from 'vitest';
import { createContext } from '../mcp/src/context.js';
import { hydrateSettlementsFromChain } from '../mcp/src/settlement-chain.js';
import { USDC_BASE } from '../mcp/src/types.js';

const PAY_TO = '0xc9cD4E19e8fFabFC479352680295ba12e454462D' as const;
const FROM = '0x00552afc18275c7723dad2EC95d77308738cE07e' as const;
const TX = '0x568fc108b0d70b9ca7f3686182391d7056f11cb581cf4ac19f448a1af798981c' as const;
const TRANSFER_TOPIC = '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef';

function padAddress(addr: string): string {
  return `0x${addr.slice(2).toLowerCase().padStart(64, '0')}`;
}

describe('hydrateSettlementsFromChain', () => {
  it('records USDC Transfer logs to payTo', async () => {
    const nowSec = Math.floor(Date.now() / 1000);
    const ctx = createContext({
      config: {
        payTo: PAY_TO,
        allowFake: true,
        signer: 'fake',
        facilitator: 'memory',
      },
      fetch: async (_input, init) => {
        const body = JSON.parse(String(init?.body ?? '{}')) as { method?: string };
        if (body.method === 'eth_blockNumber') {
          return Response.json({ result: '0x10000' });
        }
        if (body.method === 'eth_getLogs') {
          return Response.json({
            result: [
              {
                address: USDC_BASE,
                topics: [TRANSFER_TOPIC, padAddress(FROM), padAddress(PAY_TO)],
                data: `0x${(20_000).toString(16).padStart(64, '0')}`,
                transactionHash: TX,
                blockNumber: '0xff00',
              },
            ],
          });
        }
        if (body.method === 'eth_getBlockByNumber') {
          return Response.json({ result: { timestamp: `0x${nowSec.toString(16)}` } });
        }
        return Response.json({ error: { message: `unexpected ${body.method}` } }, { status: 500 });
      },
    });
    const added = await hydrateSettlementsFromChain(ctx);
    expect(added).toBeGreaterThan(0);
    const rows = ctx.settlements.transfersTo(PAY_TO, '1970-01-01T00:00:00.000Z');
    expect(rows.some((r) => r.txHash.toLowerCase() === TX)).toBe(true);
    expect(rows[0]?.amountUsd).toBe('0.02');
  });
});
