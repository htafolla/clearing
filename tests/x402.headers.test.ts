import { describe, expect, it } from 'vitest';
import {
  V1_PAYMENT_HEADER,
  V2_REQUIRED_HEADER,
  V2_SIGNATURE_HEADER,
  buildRequirements,
  decodePayload,
  encodePayload,
  parseQuote,
  paymentHeaderFromRequest,
} from '../mcp/src/x402.js';
import { PAY_TO } from './helpers.js';

describe('x402 v1/v2 headers', () => {
  const quote = buildRequirements({
    amountUsd: 0.02,
    payTo: PAY_TO,
    resource: 'https://api.clearing.dev/v1/extract',
    description: 'extract',
  });

  it('parses accepts[] body', () => {
    const got = parseQuote({ x402Version: 1, accepts: [quote] });
    expect(got?.payTo).toBe(PAY_TO);
    expect(got?.maxAmountRequired).toBe('20000');
  });

  it('parses PAYMENT-REQUIRED header', () => {
    const headers = new Headers({
      [V2_REQUIRED_HEADER]: Buffer.from(JSON.stringify({ accepts: [quote] })).toString('base64'),
    });
    const got = parseQuote({}, headers);
    expect(got?.asset.toLowerCase()).toBe('0x833589fcd6edb6e08f4c7c32d4f71b54bda02913');
  });

  it('reads X-PAYMENT and PAYMENT-SIGNATURE', () => {
    const v1 = new Headers({ [V1_PAYMENT_HEADER]: 'aaa' });
    const v2 = new Headers({ [V2_SIGNATURE_HEADER]: 'bbb' });
    expect(paymentHeaderFromRequest(v1)).toBe('aaa');
    expect(paymentHeaderFromRequest(v2)).toBe('bbb');
  });

  it('payload round-trip binds paymentId to nonce', () => {
    const b64 = encodePayload({
      x402Version: 1,
      paymentId: '11111111-1111-4111-8111-111111111111',
      nonce: '11111111-1111-4111-8111-111111111111',
      accepted: quote,
    });
    const body = decodePayload(b64);
    expect(body.paymentId).toBe(body.nonce);
    expect(body.accepted.maxAmountRequired).toBe('20000');
  });

  it('parses v2 amount + network base (not only maxAmountRequired / eip155:8453)', () => {
    const got = parseQuote({
      x402Version: 2,
      accepts: [
        {
          scheme: 'exact',
          network: 'base',
          amount: '20000',
          asset: quote.asset,
          payTo: PAY_TO,
          resource: quote.resource,
        },
      ],
    });
    expect(got?.maxAmountRequired).toBe('20000');
    expect(got?.network).toBe('eip155:8453');
  });

  it('does not treat X-Payment-TxHash as a payment', () => {
    const headers = new Headers({ 'X-Payment-TxHash': '0xdead' });
    expect(paymentHeaderFromRequest(headers)).toBeUndefined();
  });

  it('rejects non-USDC / non-Base quotes', () => {
    expect(
      parseQuote({
        accepts: [{ ...quote, asset: '0x0000000000000000000000000000000000000001' }],
      }),
    ).toBeUndefined();
    expect(parseQuote({ accepts: [{ ...quote, network: 'eip155:1' }] })).toBeUndefined();
  });
});
