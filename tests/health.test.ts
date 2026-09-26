import { afterEach, describe, expect, it } from 'vitest';
import { healthBody } from '../mcp/src/mcp-http.js';

describe('GET /health', () => {
  const prevId = process.env.CDP_API_KEY_ID;
  const prevSecret = process.env.CDP_API_KEY_SECRET;

  afterEach(() => {
    if (prevId === undefined) delete process.env.CDP_API_KEY_ID;
    else process.env.CDP_API_KEY_ID = prevId;
    if (prevSecret === undefined) delete process.env.CDP_API_KEY_SECRET;
    else process.env.CDP_API_KEY_SECRET = prevSecret;
  });

  it('reports the active facilitator next to the signer', () => {
    const zig = healthBody({ signer: 'zigzag', facilitator: 'zigzag' });
    expect(zig.signer).toBe('zigzag');
    expect(zig.facilitator).toBe('zigzag');
    const cdp = healthBody({ signer: 'x402_fetch', facilitator: 'cdp' });
    expect(cdp.facilitator).toBe('cdp');
    expect(cdp.signer).toBe('x402_fetch');
  });

  it('never includes CDP key ids or secrets', () => {
    const keyId = 'seller-key-id-should-not-leak';
    const secret = 'seller-secret-should-not-leak';
    process.env.CDP_API_KEY_ID = keyId;
    process.env.CDP_API_KEY_SECRET = secret;
    const body = healthBody({ signer: 'x402_fetch', facilitator: 'cdp' });
    expect(body).toEqual({
      status: 'healthy',
      server: 'clearing',
      version: '0.1.0',
      tools: body.tools,
      signer: 'x402_fetch',
      facilitator: 'cdp',
    });
    const text = JSON.stringify(body);
    expect(text).not.toContain(keyId);
    expect(text).not.toContain(secret);
    expect(text).not.toContain('CDP_API_KEY');
    expect(Object.keys(body).sort()).toEqual([
      'facilitator',
      'server',
      'signer',
      'status',
      'tools',
      'version',
    ]);
  });
});
