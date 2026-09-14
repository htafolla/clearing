import { describe, expect, it } from 'vitest';
import { handleExtract } from '../mcp/src/extract.js';
import { handlePin } from '../mcp/src/pin.js';
import { handleWitness } from '../mcp/src/witness.js';
import { createContext } from '../mcp/src/context.js';
import { IDENTITY_REGISTRY, type BazaarExtension, type X402Quote } from '../mcp/src/types.js';
import { V2_REQUIRED_HEADER, buildQuote, buildRequirements, decodePayload, httpGetBazaar, parseQuote } from '../mcp/src/x402.js';
import { MemoryFacilitator } from '../mcp/src/facilitator.js';
import { PAY_TO, makeCtx } from './helpers.js';

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

function assertV2Bazaar(quote: X402Quote, tag: string): void {
  expect(quote.x402Version).toBe(2);
  expect(quote.resource.url).toMatch(/^https?:\/\//);
  expect(quote.resource.mimeType).toBe('application/json');
  expect(quote.resource.serviceName).toBe('Clearing');
  expect(quote.resource.tags).toEqual([tag]);
  expect(quote.accepts[0]?.scheme).toBe('exact');
  expect(quote.accepts[0]?.network).toBe('eip155:8453');
  expect(quote.accepts[0]?.amount).toBe(quote.accepts[0]?.maxAmountRequired);
  expect(quote.accepts[0]?.amount).toMatch(/^\d+$/);
  const bazaar = quote.extensions.bazaar;
  expect(bazaar).toBeTruthy();
  expect(bazaar.info.input.type).toBe('http');
  expect(bazaar.info.input.method).toBe('GET');
  expect(bazaar.info.output?.type).toBe('json');
  expect(bazaar.info.output?.example).toBeTruthy();
  expect(bazaar.schema.$schema).toBe('https://json-schema.org/draft/2020-12/schema');
  expect(bazaar.schema.required).toEqual(['input']);
  const inputSchema = bazaar.schema.properties.input as {
    required: string[];
    properties: { type: { const: string }; method: { enum: string[] } };
  };
  expect(inputSchema.required).toEqual(expect.arrayContaining(['type', 'method']));
  expect(inputSchema.properties.type.const).toBe('http');
  expect(inputSchema.properties.method.enum).toContain('GET');
}

describe('x402 v2 + bazaar', () => {
  it('buildQuote emits v2 PaymentRequired with official bazaar GET shape', () => {
    const req = buildRequirements({
      amountUsd: 0.02,
      payTo: PAY_TO,
      resource: 'https://api.clearing.dev/v1/extract?url=https://example.com',
      description: 'Receipted URL extract',
    });
    const quote = buildQuote(req, undefined, {
      queryParams: { url: 'https://example.com' },
      querySchema: { url: { type: 'string', description: 'Public https URL to extract' } },
      requiredQuery: ['url'],
      outputExample: { title: 'Example Domain' },
      tags: ['extract'],
    });
    assertV2Bazaar(quote, 'extract');
    expect(quote.accepts[0]?.maxAmountRequired).toBe('20000');
    expect(quote.extensions.bazaar.info.input.queryParams?.url).toBe('https://example.com');
  });

  it('httpGetBazaar info is a GET http input that matches its schema contract', () => {
    const bazaar: BazaarExtension = httpGetBazaar({
      queryParams: { url: 'https://example.com' },
      querySchema: { url: { type: 'string' } },
      requiredQuery: ['url'],
      outputExample: { ok: true },
    });
    expect(bazaar.info.input.type).toBe('http');
    expect(bazaar.info.input.method).toBe('GET');
    expect(Object.keys(bazaar.info.input).every((k) => ['type', 'method', 'queryParams'].includes(k))).toBe(true);
    const input = bazaar.schema.properties.input as { additionalProperties: boolean };
    expect(input.additionalProperties).toBe(false);
  });

  it('parseQuote reads v2 amount + top-level resource.url', () => {
    const got = parseQuote({
      x402Version: 2,
      resource: { url: 'https://api.clearing.dev/v1/extract?url=https://example.com' },
      accepts: [
        {
          scheme: 'exact',
          network: 'eip155:8453',
          amount: '20000',
          asset: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913',
          payTo: PAY_TO,
        },
      ],
    });
    expect(got?.maxAmountRequired).toBe('20000');
    expect(got?.resource).toBe('https://api.clearing.dev/v1/extract?url=https://example.com');
  });

  it('unpaid extract 402 is v2 with bazaar and PAYMENT-REQUIRED', async () => {
    const ctx = makeCtx();
    const res = await handleExtract(
      new Request('https://api.clearing.dev/v1/extract?url=https://example.com'),
      ctx,
    );
    expect(res.status).toBe(402);
    expect(res.headers.get(V2_REQUIRED_HEADER)).toBeTruthy();
    const quote = (await res.json()) as X402Quote;
    assertV2Bazaar(quote, 'extract');
    expect(quote.accepts[0]?.maxAmountRequired).toBe('20000');
    expect((ctx.facilitator as MemoryFacilitator).debitCount()).toBe(0);
  });

  it('unpaid witness 402 is v2 with bazaar', async () => {
    const ctx = createContext({
      config: { allowFake: true, signer: 'fake', facilitator: 'memory', payTo: PAY_TO },
      fetch: async () => new Response('ok', { status: 200, headers: { 'content-type': 'text/plain' } }),
    });
    const res = await handleWitness(
      new Request('http://127.0.0.1/v1/witness?url=https://example.com'),
      ctx,
    );
    expect(res?.status).toBe(402);
    const quote = (await res!.json()) as X402Quote;
    assertV2Bazaar(quote, 'witness');
    expect(quote.accepts[0]?.maxAmountRequired).toBe('20000');
  });

  it('unpaid pin 402 is v2 with bazaar (no list side effect)', async () => {
    const ctx = createContext({
      config: { allowFake: true, signer: 'fake', facilitator: 'memory', payTo: OWNER },
      resolveHost: async () => ['203.0.113.10'],
      fetch: async (input, init) => {
        const url = String(input);
        if (url.includes('example.com/8004.json')) {
          return new Response(JSON.stringify({ name: 'grok' }), {
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
    const res = await handlePin(new Request('http://127.0.0.1/v1/pin?agentId=86025'), ctx);
    expect(res?.status).toBe(402);
    const quote = (await res!.json()) as X402Quote;
    assertV2Bazaar(quote, 'pin');
    expect(quote.accepts[0]?.maxAmountRequired).toBe('10000');
    const listed = await (await import('../mcp/src/listed.js')).handleListed(
      new Request('http://127.0.0.1/v1/listed'),
      ctx,
    );
    expect(listed?.status).toBe(200);
    expect(await listed!.json()).toEqual([]);
  });

  it('ZigZag-shaped v1 payload still settles extract after a v2 challenge', async () => {
    const ctx = makeCtx();
    const unpaid = await handleExtract(
      new Request('https://api.clearing.dev/v1/extract?url=https://example.com'),
      ctx,
    );
    const quote = (await unpaid.json()) as X402Quote;
    const { encodePayload } = await import('../mcp/src/x402.js');
    const header = encodePayload({
      x402Version: 1,
      paymentId: 'zigzag-v2-challenge',
      nonce: 'zigzag-v2-challenge',
      accepted: quote.accepts[0]!,
    });
    expect(decodePayload(header).x402Version).toBe(1);
    const paid = await handleExtract(
      new Request('https://api.clearing.dev/v1/extract?url=https://example.com', {
        headers: { 'X-PAYMENT': header },
      }),
      ctx,
    );
    expect(paid.status).toBe(200);
    expect((ctx.facilitator as MemoryFacilitator).debitCount()).toBe(1);
  });

  it('/.well-known/x402 keeps ATC agentToolsVerify and adds probe resources', async () => {
    const prev = process.env.CLEARING_AGENT_TOOLS_VERIFY;
    delete process.env.CLEARING_AGENT_TOOLS_VERIFY;
    delete process.env.AGENT_TOOLS_VERIFY_DESCRIPTOR;
    try {
      const ctx = makeCtx();
      const res = await handleExtract(new Request('https://clearing.rippel.ai/.well-known/x402'), ctx);
      const body = (await res.json()) as {
        agentToolsVerify: string;
        x402Version: number;
        resources: string[];
      };
      expect(body.agentToolsVerify).toBe('atc_rnW0Dzjm-5VcJzsY7wGmYtjr1jtncK69');
      expect(body.x402Version).toBe(2);
      expect(body.resources).toEqual(
        expect.arrayContaining([
          'https://clearing.rippel.ai/v1/extract?url=https://example.com',
          'https://clearing.rippel.ai/v1/witness?url=https://example.com',
        ]),
      );
    } finally {
      if (prev === undefined) delete process.env.CLEARING_AGENT_TOOLS_VERIFY;
      else process.env.CLEARING_AGENT_TOOLS_VERIFY = prev;
    }
  });

  it('GET /openapi.json is unpaid and lists extract/witness/pin', async () => {
    const ctx = makeCtx();
    const res = await handleExtract(new Request('https://clearing.rippel.ai/openapi.json'), ctx);
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      openapi: string;
      paths: Record<string, unknown>;
    };
    expect(body.openapi).toBe('3.1.0');
    expect(body.paths['/v1/extract']).toBeTruthy();
    expect(body.paths['/v1/witness']).toBeTruthy();
    expect(body.paths['/v1/pin']).toBeTruthy();
    expect((ctx.facilitator as MemoryFacilitator).debitCount()).toBe(0);
  });
});

void IDENTITY_REGISTRY;
