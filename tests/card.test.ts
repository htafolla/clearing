import { describe, expect, it } from 'vitest';
import { createContext } from '../mcp/src/context.js';
import { handleCard, handleLocker } from '../mcp/src/card.js';
import { handleHangar } from '../mcp/src/http.js';
import { encodePayload } from '../mcp/src/x402.js';
import type { PaymentRequirements } from '../mcp/src/types.js';

const PAY = '0xc9cD4E19e8fFabFC479352680295ba12e454462D' as const;
const FROM = '0x234a4B961908b20114980AF00c0974123763b48C' as const;

function payHeader(accepts: PaymentRequirements) {
  return encodePayload({
    x402Version: 1,
    paymentId: 'card-1',
    nonce: 'card-1',
    accepted: accepts,
    eip3009: {
      from: FROM,
      to: PAY,
      value: accepts.maxAmountRequired,
      validAfter: '0',
      validBefore: '9999999999',
      nonce: `0x${'11'.repeat(32)}`,
      signature: `0x${'22'.repeat(65)}`,
    },
  });
}

describe('card mill', () => {
  it('503s when mill off (no key, not fake)', async () => {
    const ctx = createContext({
      config: { allowFake: true, signer: 'fake', facilitator: 'memory', payTo: PAY },
      cardRegistrar: {
        ready: () => false,
        register: async () => {
          throw new Error('off');
        },
      },
    });
    const res = await handleCard(
      new Request('http://127.0.0.1/v1/card', {
        method: 'POST',
        body: JSON.stringify({ groover: { did: 'did:groover:ab' } }),
      }),
      ctx,
    );
    expect(res?.status).toBe(503);
  });

  it('402s then hosts card, registers 8004, transfers to payer', async () => {
    const ctx = createContext({
      config: { allowFake: true, signer: 'fake', facilitator: 'memory', payTo: PAY, extractBaseUrl: 'http://127.0.0.1' },
    });
    const unpaid = await handleCard(
      new Request('http://127.0.0.1/v1/card', {
        method: 'POST',
        body: JSON.stringify({
          groover: { did: 'did:groover:test', dynamoCitation: '0xabc' },
          endpoints: { http: 'https://clearing.rippel.ai/v1/extract?url=https://example.com' },
        }),
      }),
      ctx,
    );
    expect(unpaid?.status).toBe(402);
    const quoted = (await unpaid!.json()) as { accepts: PaymentRequirements[] };
    const header = payHeader(quoted.accepts[0]!);
    const paid = await handleCard(
      new Request('http://127.0.0.1/v1/card', {
        method: 'POST',
        headers: { 'X-PAYMENT': header },
        body: JSON.stringify({
          groover: { did: 'did:groover:test', dynamoCitation: '0xabc' },
          endpoints: { http: 'https://clearing.rippel.ai/v1/extract?url=https://example.com' },
        }),
      }),
      ctx,
    );
    expect(paid?.status).toBe(200);
    const body = (await paid!.json()) as {
      paid: boolean;
      agentId: number;
      owner: string;
      agentURI: string;
      pin: string;
    };
    expect(body.paid).toBe(true);
    expect(body.agentId).toBe(1);
    expect(body.owner.toLowerCase()).toBe(FROM.toLowerCase());
    expect(body.agentURI).toMatch(/\/v1\/card\/.+\.json$/);
    expect(body.pin).toContain('/v1/pin?agentId=1');
    const hosted = await handleCard(new Request(body.agentURI), ctx);
    expect(hosted?.status).toBe(200);
    const card = (await hosted!.json()) as { groover: { did: string } };
    expect(card.groover.did).toBe('did:groover:test');
    const locker = await handleLocker(new Request(`http://127.0.0.1/v1/locker?from=${FROM}`), ctx);
    const lock = (await locker.json()) as { cards: Array<{ agentId?: number }> };
    expect(lock.cards.some((c) => c.agentId === 1)).toBe(true);
  });

  it('hangar routes POST /v1/card', async () => {
    const ctx = createContext({
      config: { allowFake: true, signer: 'fake', facilitator: 'memory', payTo: PAY },
    });
    const res = await handleHangar(new Request('http://127.0.0.1/v1/card', { method: 'POST', body: '{}' }), ctx);
    expect(res.status).toBe(402);
  });
});
