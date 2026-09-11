import { describe, expect, it } from 'vitest';
import { createContext } from '../mcp/src/context.js';
import { handleWitness } from '../mcp/src/witness.js';
import { encodePayload } from '../mcp/src/x402.js';
import type { PaymentRequirements } from '../mcp/src/types.js';

const PAY = '0xc9cD4E19e8fFabFC479352680295ba12e454462D' as const;
const BODY = 'Groover MCP Registry active. GET /sse, POST /mcp.';

describe('GET witness', () => {
  it('402s then returns status, type, sha256, bytes — not a summary', async () => {
    const ctx = createContext({
      config: { allowFake: true, signer: 'fake', facilitator: 'memory', payTo: PAY },
      fetch: async () =>
        new Response(BODY, { status: 200, headers: { 'content-type': 'text/plain; charset=utf-8' } }),
    });
    const unpaid = await handleWitness(
      new Request('http://127.0.0.1/v1/witness?url=https://example.com/suit'),
      ctx,
    );
    expect(unpaid?.status).toBe(402);
    const quoted = (await unpaid!.json()) as { accepts: PaymentRequirements[] };
    const header = encodePayload({
      x402Version: 1,
      paymentId: 'wit-1',
      nonce: 'wit-1',
      accepted: quoted.accepts[0]!,
    });
    const paid = await handleWitness(
      new Request('http://127.0.0.1/v1/witness?url=https://example.com/suit', {
        headers: { 'X-PAYMENT': header },
      }),
      ctx,
    );
    expect(paid?.status).toBe(200);
    const body = (await paid!.json()) as {
      httpStatus: number;
      contentType: string;
      bodyBytes: number;
      bodySha256: string;
      markdown?: string;
      replayed: boolean;
    };
    expect(body.httpStatus).toBe(200);
    expect(body.contentType).toContain('text/plain');
    expect(body.bodyBytes).toBe(Buffer.byteLength(BODY));
    expect(body.bodySha256).toMatch(/^sha256:[a-f0-9]{64}$/);
    expect(body.markdown).toBeUndefined();
    expect(body.replayed).toBe(false);
  });

  it('same payload replays without a second debit', async () => {
    const ctx = createContext({
      config: { allowFake: true, signer: 'fake', facilitator: 'memory', payTo: PAY },
      fetch: async () => new Response(BODY, { status: 200, headers: { 'content-type': 'text/plain' } }),
    });
    const unpaid = await handleWitness(
      new Request('http://127.0.0.1/v1/witness?url=https://example.com/'),
      ctx,
    );
    const quoted = (await unpaid!.json()) as { accepts: PaymentRequirements[] };
    const header = encodePayload({
      x402Version: 1,
      paymentId: 'wit-replay',
      nonce: 'wit-replay',
      accepted: quoted.accepts[0]!,
    });
    const req = new Request('http://127.0.0.1/v1/witness?url=https://example.com/', {
      headers: { 'X-PAYMENT': header },
    });
    await handleWitness(req, ctx);
    const again = await handleWitness(
      new Request('http://127.0.0.1/v1/witness?url=https://example.com/', {
        headers: { 'X-PAYMENT': header },
      }),
      ctx,
    );
    const body = (await again!.json()) as { replayed: boolean };
    expect(body.replayed).toBe(true);
    expect(ctx.facilitator.debitCount()).toBe(1);
  });
});
