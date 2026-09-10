import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { createSigner, FakeSigner, HttpRailSigner } from '../mcp/src/signer.js';
import { encodePayload, buildRequirements } from '../mcp/src/x402.js';
import { PAY_TO } from './helpers.js';

const quote = buildRequirements({
  amountUsd: 0.02,
  payTo: PAY_TO,
  resource: 'https://api.clearing.dev/v1/extract',
  description: 't',
});

describe('signer rail', () => {
  it('refuses fake signer when NODE_ENV=production', () => {
    const prev = process.env.NODE_ENV;
    process.env.NODE_ENV = 'production';
    expect(() => createSigner('fake', true)).toThrow(/disabled/);
    process.env.NODE_ENV = prev;
  });

  it('HttpRailSigner never re-signs the same paymentId', async () => {
    let posts = 0;
    const paymentId = randomUUID();
    const payload = encodePayload({
      x402Version: 1,
      paymentId,
      nonce: paymentId,
      accepted: quote,
    });
    const fetchFn: typeof fetch = async () => {
      posts += 1;
      return new Response(JSON.stringify({ headerValue: payload }), { status: 200 });
    };
    const signer = new HttpRailSigner('x402_fetch', 'http://127.0.0.1:9/sign', fetchFn);
    await signer.sign({ paymentId, quote });
    await signer.sign({ paymentId, quote });
    expect(posts).toBe(1);
  });

  it('named rails without a daemon fail closed', async () => {
    const signer = createSigner('coinbase', false);
    await expect(signer.sign({ paymentId: randomUUID(), quote })).rejects.toMatchObject({ code: 'rail_missing' });
    expect(signer).not.toBeInstanceOf(FakeSigner);
  });
});
