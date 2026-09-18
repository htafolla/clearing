import { describe, expect, it } from 'vitest';
import { createContext } from '../mcp/src/context.js';
import { handleSkim } from '../mcp/src/skim.js';
import { handleHangar } from '../mcp/src/http.js';
import { encodePayload } from '../mcp/src/x402.js';
import type { PaymentRequirements } from '../mcp/src/types.js';

const PAY = '0xc9cD4E19e8fFabFC479352680295ba12e454462D' as const;
const HTML = `<html><head><title>Next GET</title></head><body>
<a href="/alpha">a</a><a href="https://example.com/beta">b</a>
<a href="https://example.com/beta">dup</a><a href="mailto:x@y.z">m</a>
</body></html>`;

describe('GET skim', () => {
  it('402s then returns title, hash, bytes, links — not markdown', async () => {
    const ctx = createContext({
      config: { allowFake: true, signer: 'fake', facilitator: 'memory', payTo: PAY },
      fetch: async () => new Response(HTML, { status: 200, headers: { 'content-type': 'text/html' } }),
    });
    const unpaid = await handleSkim(new Request('http://127.0.0.1/v1/skim?url=https://example.com/page'), ctx);
    expect(unpaid?.status).toBe(402);
    const quoted = (await unpaid!.json()) as { accepts: PaymentRequirements[] };
    expect(quoted.accepts[0]?.maxAmountRequired).toBe('10000');
    const header = encodePayload({
      x402Version: 1,
      paymentId: 'skim-1',
      nonce: 'skim-1',
      accepted: quoted.accepts[0]!,
    });
    const paid = await handleSkim(
      new Request('http://127.0.0.1/v1/skim?url=https://example.com/page', { headers: { 'X-PAYMENT': header } }),
      ctx,
    );
    expect(paid?.status).toBe(200);
    const body = (await paid!.json()) as {
      title: string;
      textHash: string;
      bytes: number;
      links: string[];
      markdown?: string;
      paid: boolean;
    };
    expect(body.paid).toBe(true);
    expect(body.title).toBe('Next GET');
    expect(body.textHash).toMatch(/^sha256:[a-f0-9]{64}$/);
    expect(body.bytes).toBe(Buffer.byteLength(HTML));
    expect(body.links).toEqual(['https://example.com/alpha', 'https://example.com/beta']);
    expect(body.markdown).toBeUndefined();
  });

  it('does not bill when the GET fails', async () => {
    const ctx = createContext({
      config: { allowFake: true, signer: 'fake', facilitator: 'memory', payTo: PAY },
      fetch: async () => {
        throw new Error('ECONNREFUSED');
      },
    });
    const res = await handleSkim(new Request('http://127.0.0.1/v1/skim?url=https://example.com/down'), ctx);
    expect(res?.status).toBe(400);
    const body = (await res!.json()) as { paid: boolean };
    expect(body.paid).toBe(false);
    expect(ctx.facilitator.debitCount()).toBe(0);
  });

  it('hangar routes /v1/skim', async () => {
    const ctx = createContext({
      config: { allowFake: true, signer: 'fake', facilitator: 'memory', payTo: PAY },
      fetch: async () => new Response('<html><title>x</title></html>', { status: 200 }),
    });
    const res = await handleHangar(new Request('http://127.0.0.1/v1/skim?url=https://example.com/'), ctx);
    expect(res.status).toBe(402);
  });
});
