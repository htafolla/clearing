import { describe, expect, it } from 'vitest';
import { handleExtract } from '../mcp/src/extract.js';
import { MemoryFacilitator } from '../mcp/src/facilitator.js';
import { makeCtx, urlOf } from './helpers.js';

describe('blocked extract is not charged', () => {
  it('robots.txt Disallow → blocked:true and no debit', async () => {
    const record: string[] = [];
    const ctx = makeCtx({
      'https://blocked.example/robots.txt': {
        status: 200,
        body: 'User-agent: *\nDisallow: /\n',
      },
      'https://blocked.example/secret': { body: '<html><title>stolen</title><p>nope</p></html>' },
    });
    const inner = ctx.fetch;
    ctx.fetch = async (input, init) => {
      record.push(urlOf(input));
      return inner(input, init);
    };
    const res = await handleExtract(
      new Request(`https://api.clearing.dev/v1/extract?url=${encodeURIComponent('https://blocked.example/secret')}`),
      ctx,
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { blocked: boolean; reason: string; markdown: string };
    expect(body.blocked).toBe(true);
    expect(body.reason).toBe('robots.txt');
    expect(body.markdown).toBe('');
    expect((ctx.facilitator as MemoryFacilitator).debitCount()).toBe(0);
    expect(record.some((u) => u.includes('/secret'))).toBe(false);
  });

  it('no-ai meta → blocked:true and no debit', async () => {
    const ctx = makeCtx({
      'https://noai.example/robots.txt': { status: 200, body: 'User-agent: *\nAllow: /\n' },
      'https://noai.example/post': {
        body: `<html><head><meta name="robots" content="noai, noimageai"><title>Nope</title></head><body><p>private</p></body></html>`,
      },
    });
    const res = await handleExtract(
      new Request(`https://api.clearing.dev/v1/extract?url=${encodeURIComponent('https://noai.example/post')}`),
      ctx,
    );
    const body = (await res.json()) as { blocked: boolean; reason: string };
    expect(body.blocked).toBe(true);
    expect(body.reason).toBe('no-ai');
    expect((ctx.facilitator as MemoryFacilitator).debitCount()).toBe(0);
  });

  it('public origin redirecting to loopback is blocked with no debit', async () => {
    const ctx = makeCtx({
      'https://redir.example/robots.txt': { status: 200, body: 'User-agent: *\nAllow: /\n' },
      'https://redir.example/page': {
        status: 302,
        headers: { location: 'http://127.0.0.1/secret' },
        body: '',
      },
    });
    const res = await handleExtract(
      new Request(`https://api.clearing.dev/v1/extract?url=${encodeURIComponent('https://redir.example/page')}`),
      ctx,
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { blocked: boolean; reason: string };
    expect(body.blocked).toBe(true);
    expect(body.reason).toBe('ssrf');
    expect((ctx.facilitator as MemoryFacilitator).debitCount()).toBe(0);
  });

  it('resolved private IP → no fetch and no debit', async () => {
    const record: string[] = [];
    const ctx = makeCtx(
      {},
      {
        resolveHost: async () => ['127.0.0.1'],
      },
    );
    const inner = ctx.fetch;
    ctx.fetch = async (input, init) => {
      record.push(urlOf(input));
      return inner(input, init);
    };
    const res = await handleExtract(
      new Request(`https://api.clearing.dev/v1/extract?url=${encodeURIComponent('https://example.com')}`),
      ctx,
    );
    expect(res.status).toBe(400);
    expect((ctx.facilitator as MemoryFacilitator).debitCount()).toBe(0);
    expect(record.some((u) => u.includes('example.com') && !u.includes('api.clearing.dev'))).toBe(false);
  });

  it('upstream 402 paid-origin → blocked:true and no debit', async () => {
    const ctx = makeCtx({
      'https://cf.example/robots.txt': { status: 200, body: 'User-agent: *\nAllow: /\n' },
      'https://cf.example/article': {
        status: 402,
        body: JSON.stringify({ accepts: [{ payTo: '0x1111111111111111111111111111111111111111' }] }),
      },
    });
    const res = await handleExtract(
      new Request(`https://api.clearing.dev/v1/extract?url=${encodeURIComponent('https://cf.example/article')}`),
      ctx,
    );
    const body = (await res.json()) as { blocked: boolean; reason: string };
    expect(body.blocked).toBe(true);
    expect(body.reason).toBe('paid-origin');
    expect((ctx.facilitator as MemoryFacilitator).debitCount()).toBe(0);
  });
});
