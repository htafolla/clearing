import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { handleExtract } from '../mcp/src/extract.js';
import { fetchPaid } from '../mcp/src/pay.js';
import { handleTool } from '../mcp/src/tools.js';
import { V1_PAYMENT_HEADER, V2_REQUIRED_HEADER, decodePayload } from '../mcp/src/x402.js';
import { MemoryFacilitator } from '../mcp/src/facilitator.js';
import { FakeSigner } from '../mcp/src/signer.js';
import { EXAMPLE_HTML, makeCtx } from './helpers.js';

function extractUrl(page = 'https://example.com'): string {
  return `https://api.clearing.dev/v1/extract?url=${encodeURIComponent(page)}`;
}

describe('extract 402', () => {
  it('unpaid extract → 402 with Base USDC quote', async () => {
    const ctx = makeCtx();
    const res = await handleExtract(new Request(extractUrl()), ctx);
    expect(res.status).toBe(402);
    const body = (await res.json()) as { accepts: Array<{ asset: string; network: string; payTo: string; maxAmountRequired: string }> };
    expect(body.accepts[0]?.network).toBe('eip155:8453');
    expect(body.accepts[0]?.asset.toLowerCase()).toBe('0x833589fcd6edb6e08f4c7c32d4f71b54bda02913');
    expect(body.accepts[0]?.maxAmountRequired).toBe('20000');
    expect(res.headers.get(V2_REQUIRED_HEADER)).toBeTruthy();
    expect((ctx.facilitator as MemoryFacilitator).debitCount()).toBe(0);
  });

  it('paid extract → 200 + textHash', async () => {
    const ctx = makeCtx();
    const unpaid = await handleExtract(new Request(extractUrl()), ctx);
    const quote = (await unpaid.json()) as { accepts: [{ maxAmountRequired: string; payTo: string; resource: string; asset: string; network: string; scheme: 'exact'; description: string; mimeType: 'application/json'; maxTimeoutSeconds: number; extra: { name: 'USDC'; version: '2' } }] };
    const signed = await ctx.signer.sign({
      paymentId: randomUUID(),
      quote: quote.accepts[0],
    });
    const paid = await handleExtract(
      new Request(extractUrl(), { headers: { [V1_PAYMENT_HEADER]: signed.headerValue } }),
      ctx,
    );
    expect(paid.status).toBe(200);
    const body = (await paid.json()) as {
      markdown: string;
      textHash: string;
      blocked: boolean;
      title: string;
      txHash: string;
      httpStatus?: number;
      bodySha256?: string;
      bodyBytes?: number;
    };
    expect(body.blocked).toBe(false);
    expect(body.title).toBe('Example Domain');
    expect(body.markdown).toContain('Example Domain');
    expect(body.textHash).toMatch(/^sha256:[a-f0-9]{64}$/);
    expect(body.txHash).toMatch(/^0x[a-f0-9]+$/);
    expect(body.httpStatus).toBe(200);
    expect(body.bodySha256).toMatch(/^sha256:[a-f0-9]{64}$/);
    expect((body.bodyBytes ?? 0) > 0).toBe(true);
    expect((ctx.facilitator as MemoryFacilitator).debitCount()).toBe(1);
  });

  it('MCP extract wrapper is the same price as HTTP 402', async () => {
    const ctx = makeCtx();
    const result = (await handleTool(
      'extract',
      { url: 'https://example.com', dryRun: false },
      ctx,
    )) as { paid: boolean; amountUsd: string; body: { textHash: string } };
    expect(result.paid).toBe(true);
    expect(result.amountUsd).toBe('0.02');
    expect(result.body.textHash).toMatch(/^sha256:/);
  });

  it('js=1 quotes 0.05 and fails closed without a renderer (no charge)', async () => {
    const ctx = makeCtx();
    const res = await handleExtract(new Request(`${extractUrl()}&js=1`), ctx);
    expect(res.status).toBe(400);
    const body = (await res.json()) as { reason: string };
    expect(body.reason).toBe('js_unavailable');
    expect((ctx.facilitator as MemoryFacilitator).debitCount()).toBe(0);
  });

  it('cache hit still settles a new paymentId (metered, not a discount)', async () => {
    const ctx = makeCtx();
    const first = await fetchPaid({ url: extractUrl(), maxUsd: 0.02, dryRun: false }, ctx);
    expect(first.paid).toBe(true);
    const second = await fetchPaid({ url: extractUrl(), maxUsd: 0.02, dryRun: false }, ctx);
    expect(second.paid).toBe(true);
    expect(second.paymentId).not.toBe(first.paymentId);
    expect((ctx.facilitator as MemoryFacilitator).debitCount()).toBe(2);
    expect(
      ctx.settlements.transfersTo(ctx.config.payTo, '1970-01-01T00:00:00.000Z').length,
    ).toBeGreaterThanOrEqual(2);
  });

  it('payment payload never re-signs for the same paymentId', async () => {
    const signer = new FakeSigner();
    const ctx = makeCtx({}, { signer });
    const paymentId = randomUUID();
    await fetchPaid({ url: extractUrl(), maxUsd: 0.02, dryRun: false, paymentId }, ctx);
    await fetchPaid({ url: extractUrl(), maxUsd: 0.02, dryRun: false, paymentId }, ctx);
    expect(signer.signCount).toBe(1);
    const row = ctx.ledger.get(paymentId);
    expect(row?.payloadB64).toBeTruthy();
    expect(decodePayload(row!.payloadB64!).nonce).toBe(paymentId);
  });

  it('serves unpaid public cards', async () => {
    const ctx = makeCtx();
    const agents = await handleExtract(new Request('https://api.clearing.dev/agents.md'), ctx);
    const card = await handleExtract(new Request('https://api.clearing.dev/.well-known/agent.json'), ctx);
    expect(agents.status).toBe(200);
    expect(await agents.text()).toContain('never `xray-clearing`');
    expect(card.status).toBe(200);
    expect((ctx.facilitator as MemoryFacilitator).debitCount()).toBe(0);
  });

  it('GET /.well-known/x402 includes ATC descriptor agentToolsVerify', async () => {
    const prevClearing = process.env.CLEARING_AGENT_TOOLS_VERIFY;
    const prevDescriptor = process.env.AGENT_TOOLS_VERIFY_DESCRIPTOR;
    const prevRailway = process.env.AGENT_TOOLS_VERIFY_TOKEN_RAILWAY;
    delete process.env.CLEARING_AGENT_TOOLS_VERIFY;
    delete process.env.AGENT_TOOLS_VERIFY_DESCRIPTOR;
    process.env.AGENT_TOOLS_VERIFY_TOKEN_RAILWAY = 'atc_r6O9K2gBe1-IuHPkirXKsiJ4TQSYNIkx';
    try {
      const ctx = makeCtx();
      const res = await handleExtract(new Request('https://clearing-production-9968.up.railway.app/.well-known/x402'), ctx);
      expect(res.status).toBe(200);
      expect(res.headers.get('content-type')).toMatch(/application\/json/);
      const body = (await res.json()) as { agentToolsVerify: string };
      expect(body.agentToolsVerify).toBe('atc_rnW0Dzjm-5VcJzsY7wGmYtjr1jtncK69');
      expect((ctx.facilitator as MemoryFacilitator).debitCount()).toBe(0);
    } finally {
      if (prevClearing === undefined) delete process.env.CLEARING_AGENT_TOOLS_VERIFY;
      else process.env.CLEARING_AGENT_TOOLS_VERIFY = prevClearing;
      if (prevDescriptor === undefined) delete process.env.AGENT_TOOLS_VERIFY_DESCRIPTOR;
      else process.env.AGENT_TOOLS_VERIFY_DESCRIPTOR = prevDescriptor;
      if (prevRailway === undefined) delete process.env.AGENT_TOOLS_VERIFY_TOKEN_RAILWAY;
      else process.env.AGENT_TOOLS_VERIFY_TOKEN_RAILWAY = prevRailway;
    }
  });

  it('CLEARING_AGENT_TOOLS_VERIFY overrides x402 agentToolsVerify', async () => {
    const prev = process.env.CLEARING_AGENT_TOOLS_VERIFY;
    process.env.CLEARING_AGENT_TOOLS_VERIFY = 'atc_override_descriptor';
    try {
      const ctx = makeCtx();
      const res = await handleExtract(new Request('https://clearing.rippel.ai/.well-known/x402'), ctx);
      const body = (await res.json()) as { agentToolsVerify: string };
      expect(body.agentToolsVerify).toBe('atc_override_descriptor');
    } finally {
      if (prev === undefined) delete process.env.CLEARING_AGENT_TOOLS_VERIFY;
      else process.env.CLEARING_AGENT_TOOLS_VERIFY = prev;
    }
  });

  it('does not change rippel agent-tools-verify.txt claim', async () => {
    const ctx = makeCtx();
    const res = await handleExtract(
      new Request('https://clearing.rippel.ai/.well-known/agent-tools-verify.txt'),
      ctx,
    );
    expect(res.status).toBe(200);
    expect(await res.text()).toBe('atc_ahATpKU6I8yhcD0aIdaKZp3ONf0bjyj9');
  });

  it('railway agent-tools-verify.txt stays the railway file claim', async () => {
    const prev = process.env.AGENT_TOOLS_VERIFY_TOKEN_RAILWAY;
    delete process.env.AGENT_TOOLS_VERIFY_TOKEN_RAILWAY;
    try {
      const ctx = makeCtx();
      const res = await handleExtract(
        new Request('https://clearing-production-9968.up.railway.app/.well-known/agent-tools-verify.txt'),
        ctx,
      );
      expect(await res.text()).toBe('atc_r6O9K2gBe1-IuHPkirXKsiJ4TQSYNIkx');
    } finally {
      if (prev === undefined) delete process.env.AGENT_TOOLS_VERIFY_TOKEN_RAILWAY;
      else process.env.AGENT_TOOLS_VERIFY_TOKEN_RAILWAY = prev;
    }
  });

  it('does not fetch private extract targets', async () => {
    const ctx = makeCtx();
    const res = await handleExtract(
      new Request(`https://api.clearing.dev/v1/extract?url=${encodeURIComponent('http://127.0.0.1/')}`),
      ctx,
    );
    expect(res.status).toBe(400);
  });
});

void EXAMPLE_HTML;
