import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { createSigner, FakeSigner, HttpRailSigner } from '../mcp/src/signer.js';
import { InProcessOwsSigner } from '../mcp/src/ows-signer.js';
import { encodePayload, buildRequirements } from '../mcp/src/x402.js';
import { PAY_TO } from './helpers.js';

const quote = buildRequirements({
  amountUsd: 0.02,
  payTo: PAY_TO,
  resource: 'https://api.clearing.dev/v1/extract',
  description: 't',
});

describe('signer rail', () => {
  it('refuses fake signer unless allowFake is set', () => {
    expect(() => createSigner('fake', false)).toThrow(/disabled/);
  });

  it('allows fake signer when allowFake is explicit, even in production', () => {
    const prev = process.env.NODE_ENV;
    process.env.NODE_ENV = 'production';
    expect(createSigner('fake', true).kind).toBe('fake');
    process.env.NODE_ENV = prev;
  });

  it('zigzag loopback uses in-process OWS, not :8789', () => {
    const prev = process.env.CLEARING_ZIGZAG_URL;
    delete process.env.CLEARING_ZIGZAG_URL;
    delete process.env.CLEARING_SIGNER_URL;
    const signer = createSigner('zigzag', false);
    expect(signer).toBeInstanceOf(InProcessOwsSigner);
    const loop = createSigner('zigzag', false, { signerUrl: 'http://127.0.0.1:8789' });
    expect(loop).toBeInstanceOf(InProcessOwsSigner);
    if (prev !== undefined) process.env.CLEARING_ZIGZAG_URL = prev;
  });

  it('zigzag https rail stays HTTP signer', () => {
    const signer = createSigner('zigzag', false, {
      signerUrl: 'https://zigzag-mcp-production.up.railway.app',
    });
    expect(signer).toBeInstanceOf(HttpRailSigner);
  });

  it('HttpRailSigner never re-signs the same paymentId', async () => {
    process.env.CLEARING_RAIL_TOKEN = 'test-rail';
    let posts = 0;
    const paymentId = randomUUID();
    const payload = encodePayload({
      x402Version: 1,
      paymentId,
      nonce: paymentId,
      accepted: quote,
    });
    const fetchFn: typeof fetch = async (_url, init) => {
      posts += 1;
      const headers = new Headers(init?.headers);
      expect(headers.get('authorization')).toBe('Bearer test-rail');
      const body = JSON.parse(String(init?.body ?? '{}')) as { approved?: boolean };
      expect(body.approved).toBe(false);
      return new Response(JSON.stringify({ headerValue: payload }), { status: 200 });
    };
    const signer = new HttpRailSigner('x402_fetch', 'http://127.0.0.1:9/sign', fetchFn);
    await signer.sign({ paymentId, quote });
    await signer.sign({ paymentId, quote });
    expect(posts).toBe(1);
  });

  it('HttpRailSigner only sets approved when the operator passed it', async () => {
    const paymentId = randomUUID();
    const payload = encodePayload({
      x402Version: 1,
      paymentId,
      nonce: paymentId,
      accepted: quote,
    });
    const fetchFn: typeof fetch = async (_url, init) => {
      const body = JSON.parse(String(init?.body ?? '{}')) as { approved?: boolean };
      expect(body.approved).toBe(true);
      return new Response(JSON.stringify({ headerValue: payload }), { status: 200 });
    };
    const signer = new HttpRailSigner('zigzag', 'http://127.0.0.1:9/sign', fetchFn);
    await signer.sign({ paymentId, quote, approved: true });
  });

  it('named rails without a daemon fail closed', async () => {
    const signer = createSigner('coinbase', false);
    await expect(signer.sign({ paymentId: randomUUID(), quote })).rejects.toMatchObject({ code: 'rail_missing' });
    expect(signer).not.toBeInstanceOf(FakeSigner);
  });
});
