import { generateKeyPairSync } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { cdpBearerJwt, hasCdpKeys } from '../mcp/src/cdp-auth.js';
import {
  CdpFacilitator,
  MemoryFacilitator,
  bazaarResourceUrl,
  cdpCatalogResource,
  pingFacilitator,
  toCdpSettleBody,
} from '../mcp/src/facilitator.js';
import { encodePayload } from '../mcp/src/x402.js';
import { USDC_BASE, USDC_EIP712_NAME, type PaymentRequirements } from '../mcp/src/types.js';

const PAY = '0xc9cD4E19e8fFabFC479352680295ba12e454462D' as const;
const FROM = '0x234a4B961908b20114980AF00c0974123763b48C' as const;
const TX = `0x${'ab'.repeat(32)}` as const;

function ed25519Secret(): { id: string; secret: string } {
  const { privateKey } = generateKeyPairSync('ed25519');
  const jwk = privateKey.export({ format: 'jwk' });
  if (!jwk.d || !jwk.x) throw new Error('ed25519 jwk missing d/x');
  const secret = Buffer.concat([
    Buffer.from(jwk.d, 'base64url'),
    Buffer.from(jwk.x, 'base64url'),
  ]).toString('base64');
  return { id: '00000000-0000-4000-8000-000000000001', secret };
}

function expectedShop(): PaymentRequirements {
  return {
    scheme: 'exact',
    network: 'eip155:8453',
    maxAmountRequired: '10000',
    asset: USDC_BASE,
    payTo: PAY.toLowerCase() as `0x${string}`,
    resource: 'https://clearing.rippel.ai/v1/skim?url=https://example.com',
    description: 'x402 shop. Unpaid GET returns 402.',
    mimeType: 'application/json',
    maxTimeoutSeconds: 60,
    extra: { name: USDC_EIP712_NAME, version: '2' },
  };
}

function paidHeader(): string {
  const req = expectedShop();
  return encodePayload({
    x402Version: 1,
    paymentId: 'ping-cdp-1',
    nonce: 'ping-cdp-1',
    accepted: req,
    eip3009: {
      from: FROM,
      to: PAY,
      value: '10000',
      validAfter: '0',
      validBefore: '9999999999',
      nonce: `0x${'11'.repeat(32)}`,
      signature: `0x${'22'.repeat(65)}`,
    },
  });
}

describe('CDP facilitator', () => {
  it('JWT is EdDSA with kid and uri', () => {
    const { id, secret } = ed25519Secret();
    const jwt = cdpBearerJwt({
      apiKeyId: id,
      apiKeySecret: secret,
      method: 'POST',
      host: 'api.cdp.coinbase.com',
      path: '/platform/v2/x402/settle',
    });
    const [h, p] = jwt.split('.');
    const header = JSON.parse(Buffer.from(h!, 'base64url').toString()) as { alg: string; kid: string };
    const claims = JSON.parse(Buffer.from(p!, 'base64url').toString()) as { uri: string; iss: string };
    expect(header.alg).toBe('EdDSA');
    expect(header.kid).toBe(id);
    expect(claims.iss).toBe('cdp');
    expect(claims.uri).toBe('POST api.cdp.coinbase.com/platform/v2/x402/settle');
  });

  it('maps EIP-3009 to v2 exact payload and strips shop query, never ping', () => {
    const req = expectedShop();
    const body = {
      x402Version: 1 as const,
      paymentId: 'ping-cdp-1',
      nonce: 'ping-cdp-1',
      accepted: req,
      eip3009: {
        from: FROM,
        to: PAY,
        value: '10000',
        validAfter: '0',
        validBefore: '9999999999',
        nonce: `0x${'11'.repeat(32)}` as `0x${string}`,
        signature: `0x${'22'.repeat(65)}` as `0x${string}`,
      },
    };
    const mapped = toCdpSettleBody(body, req);
    expect('error' in mapped).toBe(false);
    if ('error' in mapped) return;
    expect(mapped.paymentPayload.resource.url).toBe('https://clearing.rippel.ai/v1/skim');
    expect(mapped.paymentPayload.payload.authorization.from).toBe(FROM);
    expect(mapped.paymentPayload.accepted.extra.name).toBe('USD Coin');
    expect(mapped.paymentPayload.extensions.bazaar.info.input.method).toBe('GET');
    expect(cdpCatalogResource(req)).toBe('https://clearing.rippel.ai/v1/skim');
    expect(bazaarResourceUrl('https://clearing.rippel.ai/v1/ping')).toBeUndefined();
    const pingReq = { ...req, resource: 'https://clearing.rippel.ai/v1/ping' };
    const refused = toCdpSettleBody(body, pingReq);
    expect('error' in refused).toBe(true);
  });

  it('verify then settle; never posts ZigZag', async () => {
    const { id, secret } = ed25519Secret();
    const urls: string[] = [];
    const rail = new CdpFacilitator({
      apiKeyId: id,
      apiKeySecret: secret,
      fetchFn: async (input, init) => {
        const u = String(input);
        urls.push(u);
        expect(u.includes('zigzag')).toBe(false);
        const body = JSON.parse(String(init?.body ?? '{}')) as {
          paymentPayload?: { resource?: { url?: string } };
        };
        if (u.endsWith('/x402/verify')) {
          expect(body.paymentPayload?.resource?.url).toBe('https://clearing.rippel.ai/v1/skim');
          return new Response(JSON.stringify({ isValid: true }), { status: 200 });
        }
        if (u.endsWith('/x402/settle')) {
          return new Response(JSON.stringify({ success: true, transaction: TX }), { status: 200 });
        }
        return new Response('no', { status: 404 });
      },
    });
    const out = await rail.settle(paidHeader(), expectedShop());
    expect(out.ok).toBe(true);
    expect(out.txHash).toBe(TX);
    expect(urls).toEqual([
      'https://api.cdp.coinbase.com/platform/v2/x402/verify',
      'https://api.cdp.coinbase.com/platform/v2/x402/settle',
    ]);
  });

  it('does not settle when verify rejects', async () => {
    const { id, secret } = ed25519Secret();
    const urls: string[] = [];
    const rail = new CdpFacilitator({
      apiKeyId: id,
      apiKeySecret: secret,
      fetchFn: async (input) => {
        urls.push(String(input));
        return new Response(JSON.stringify({ isValid: false, invalidReason: 'bad sig' }), { status: 200 });
      },
    });
    const out = await rail.settle(paidHeader(), expectedShop());
    expect(out.ok).toBe(false);
    expect(out.error).toMatch(/bad sig/);
    expect(urls).toEqual(['https://api.cdp.coinbase.com/platform/v2/x402/verify']);
  });

  it('pingFacilitator uses CDP when keys exist', () => {
    const prevId = process.env.CDP_API_KEY_ID;
    const prevSecret = process.env.CDP_API_KEY_SECRET;
    try {
      expect(hasCdpKeys()).toBe(false);
      const memory = new MemoryFacilitator();
      expect(pingFacilitator(memory, fetch, true)).toBe(memory);
      const { id, secret } = ed25519Secret();
      process.env.CDP_API_KEY_ID = id;
      process.env.CDP_API_KEY_SECRET = secret;
      expect(hasCdpKeys()).toBe(true);
      expect(pingFacilitator(memory, fetch, false)).toBe(memory);
      expect(pingFacilitator(memory, fetch, true)).toBeInstanceOf(CdpFacilitator);
    } finally {
      if (prevId === undefined) delete process.env.CDP_API_KEY_ID;
      else process.env.CDP_API_KEY_ID = prevId;
      if (prevSecret === undefined) delete process.env.CDP_API_KEY_SECRET;
      else process.env.CDP_API_KEY_SECRET = prevSecret;
    }
  });
});
