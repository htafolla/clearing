import { describe, expect, it } from 'vitest';
import { createContext } from '../mcp/src/context.js';
import { handlePin } from '../mcp/src/pin.js';
import { IDENTITY_REGISTRY } from '../mcp/src/types.js';

const OWNER = '0xd45CcF98D6db5A36E7CdD10ffae0b685BF27CE43';
const CARD_URI = 'https://example.com/8004.json';

function abiString(s: string): string {
  const data = Buffer.from(s, 'utf8');
  const len = data.length.toString(16).padStart(64, '0');
  const body = data.toString('hex').padEnd(Math.ceil(data.length / 32) * 64, '0');
  return `0x${'20'.padStart(64, '0')}${len}${body}`;
}

function ownerWord(addr: string): string {
  return `0x${addr.slice(2).toLowerCase().padStart(64, '0')}`;
}

describe('8004-pin', () => {
  it('402s then returns owner, uri, sha256 after fake settle', async () => {
    const ctx = createContext({
      config: { allowFake: true, signer: 'fake', facilitator: 'memory', payTo: OWNER },
      fetch: async (input, init) => {
        const url = String(input);
        if (url.includes('example.com/8004.json')) {
          return new Response(JSON.stringify({ name: 'grok', type: 'https://eips.ethereum.org/EIPS/eip-8004#registration-v1' }), {
            headers: { 'content-type': 'application/json' },
          });
        }
        const body = JSON.parse(String(init?.body ?? '{}')) as { params?: [{ data?: string }] };
        const data = body.params?.[0]?.data ?? '';
        if (data.startsWith('0x6352211e')) return Response.json({ result: ownerWord(OWNER) });
        if (data.startsWith('0xc87b56dd')) return Response.json({ result: abiString(CARD_URI) });
        return Response.json({ error: { message: 'unexpected' } }, { status: 500 });
      },
    });
    const unpaid = await handlePin(new Request('http://127.0.0.1/v1/pin?agentId=86025'), ctx);
    expect(unpaid?.status).toBe(402);

    const quoted = (await unpaid!.json()) as { accepts: import('../mcp/src/types.js').PaymentRequirements[] };
    const { encodePayload } = await import('../mcp/src/x402.js');
    const header = encodePayload({
      x402Version: 1,
      paymentId: 'pin-1',
      nonce: 'pin-1',
      accepted: quoted.accepts[0]!,
    });
    const paid = await handlePin(
      new Request('http://127.0.0.1/v1/pin?agentId=86025', { headers: { 'X-PAYMENT': header } }),
      ctx,
    );
    expect(paid?.status).toBe(200);
    const body = (await paid!.json()) as { owner: string; agentURI: string; sha256: string; card: { name: string } };
    expect(body.owner.toLowerCase()).toBe(OWNER.toLowerCase());
    expect(body.agentURI).toBe(CARD_URI);
    expect(body.card.name).toBe('grok');
    expect(body.sha256).toHaveLength(64);
  });

  it('404s unknown agent before charging', async () => {
    const ctx = createContext({
      config: { allowFake: true, signer: 'fake', facilitator: 'memory' },
      fetch: async () => Response.json({ result: '0x' }),
    });
    const res = await handlePin(new Request('http://127.0.0.1/v1/pin?agentId=1'), ctx);
    expect(res?.status).toBe(404);
  });

  it('ignores non-pin paths', async () => {
    const ctx = createContext({ config: { allowFake: true } });
    expect(await handlePin(new Request('http://127.0.0.1/v1/extract'), ctx)).toBeUndefined();
  });

  it('refuses private tokenURI before charging', async () => {
    const ctx = createContext({
      config: { allowFake: true, signer: 'fake', facilitator: 'memory', payTo: OWNER },
      fetch: async (_input, init) => {
        const body = JSON.parse(String(init?.body ?? '{}')) as { params?: [{ data?: string }] };
        const data = body.params?.[0]?.data ?? '';
        if (data.startsWith('0x6352211e')) return Response.json({ result: ownerWord(OWNER) });
        if (data.startsWith('0xc87b56dd')) return Response.json({ result: abiString('http://127.0.0.1/card.json') });
        return Response.json({ error: { message: 'no http get expected' } }, { status: 500 });
      },
    });
    const unpaid = await handlePin(new Request('http://127.0.0.1/v1/pin?agentId=7'), ctx);
    expect(unpaid?.status).toBe(400);
    const unpaidBody = (await unpaid!.json()) as { paid: boolean; error: string };
    expect(unpaidBody.paid).toBe(false);
    expect(unpaidBody.error).toMatch(/private extract target/i);
    expect(ctx.facilitator.debitCount()).toBe(0);

    const { encodePayload } = await import('../mcp/src/x402.js');
    const header = encodePayload({
      x402Version: 1,
      paymentId: 'pin-ssrf',
      nonce: 'pin-ssrf',
      accepted: {
        scheme: 'exact',
        network: 'eip155:8453',
        maxAmountRequired: '10000',
        asset: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913',
        payTo: OWNER,
        resource: 'http://127.0.0.1/v1/pin?agentId=7',
        description: 'ERC-8004 pin agentId 7',
        mimeType: 'application/json',
        maxTimeoutSeconds: 60,
        extra: { name: 'USDC', version: '2' },
      },
    });
    const withPay = await handlePin(
      new Request('http://127.0.0.1/v1/pin?agentId=7', { headers: { 'X-PAYMENT': header } }),
      ctx,
    );
    expect(withPay?.status).toBe(400);
    expect(ctx.facilitator.debitCount()).toBe(0);
  });

  it('canonical registry constant', () => {
    expect(IDENTITY_REGISTRY.toLowerCase()).toBe('0x8004a169fb4a3325136eb29fa0ceb6d2e539a432');
  });
});
