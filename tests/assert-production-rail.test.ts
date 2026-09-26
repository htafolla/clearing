import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { assertProductionRail } from '../mcp/src/production-rail.js';
import { createContext } from '../mcp/src/context.js';
import { CdpFacilitator, createFacilitator } from '../mcp/src/facilitator.js';
import { PAY_TO } from './helpers.js';

describe('assertProductionRail', () => {
  const keys = [
    'NODE_ENV',
    'RAILWAY_ENVIRONMENT',
    'CLEARING_FACILITATOR',
    'CLEARING_SIGNER',
    'CLEARING_RAIL_TOKEN',
    'ZIGZAG_RAIL_TOKEN',
    'CLEARING_ZIGZAG_URL',
    'CLEARING_SIGNER_URL',
    'CLEARING_ZIGZAG_SETTLE_URL',
    'CDP_API_KEY_ID',
    'CDP_API_KEY_SECRET',
    'CLEARING_PAY_TO',
    'CLEARING_ALLOW_FAKE',
  ] as const;
  const prev: Record<string, string | undefined> = {};

  beforeEach(() => {
    for (const k of keys) prev[k] = process.env[k];
  });

  afterEach(() => {
    for (const k of keys) {
      if (prev[k] === undefined) delete process.env[k];
      else process.env[k] = prev[k];
    }
  });

  it('noops outside production', () => {
    process.env.NODE_ENV = 'test';
    delete process.env.RAILWAY_ENVIRONMENT;
    expect(() => assertProductionRail()).not.toThrow();
  });

  it('throws in production without zigzag rail token', () => {
    process.env.NODE_ENV = 'production';
    delete process.env.RAILWAY_ENVIRONMENT;
    delete process.env.CLEARING_FACILITATOR;
    process.env.CLEARING_SIGNER = 'fake';
    delete process.env.CLEARING_RAIL_TOKEN;
    delete process.env.ZIGZAG_RAIL_TOKEN;
    expect(() => assertProductionRail()).toThrow(/CLEARING_SIGNER=zigzag/);
  });

  it('passes in production with zigzag and token', () => {
    process.env.NODE_ENV = 'production';
    delete process.env.CLEARING_FACILITATOR;
    process.env.CLEARING_SIGNER = 'zigzag';
    process.env.CLEARING_RAIL_TOKEN = 't';
    expect(() => assertProductionRail()).not.toThrow();
  });

  it('zigzag mode still requires signer and rail token even when CDP keys exist', () => {
    process.env.NODE_ENV = 'production';
    delete process.env.RAILWAY_ENVIRONMENT;
    process.env.CLEARING_FACILITATOR = 'zigzag';
    delete process.env.CLEARING_SIGNER;
    delete process.env.CLEARING_RAIL_TOKEN;
    delete process.env.ZIGZAG_RAIL_TOKEN;
    delete process.env.CLEARING_ZIGZAG_URL;
    process.env.CDP_API_KEY_ID = 'seller-key-id';
    process.env.CDP_API_KEY_SECRET = 'seller-key-secret';
    expect(() => assertProductionRail()).toThrow(
      'production Clearing requires CLEARING_SIGNER=zigzag and CLEARING_RAIL_TOKEN',
    );
  });

  it('zigzag facilitator still requires CLEARING_ZIGZAG_URL', () => {
    delete process.env.CLEARING_ZIGZAG_URL;
    delete process.env.CLEARING_SIGNER_URL;
    delete process.env.CLEARING_ZIGZAG_SETTLE_URL;
    process.env.CDP_API_KEY_ID = 'seller-key-id';
    process.env.CDP_API_KEY_SECRET = 'seller-key-secret';
    expect(() => createFacilitator('zigzag', false)).toThrow(
      'CLEARING_ZIGZAG_URL required for zigzag facilitator',
    );
  });

  it('cdp mode passes with only the CDP vars', () => {
    process.env.NODE_ENV = 'production';
    delete process.env.RAILWAY_ENVIRONMENT;
    process.env.CLEARING_FACILITATOR = 'cdp';
    delete process.env.CLEARING_SIGNER;
    delete process.env.CLEARING_RAIL_TOKEN;
    delete process.env.ZIGZAG_RAIL_TOKEN;
    delete process.env.CLEARING_ZIGZAG_URL;
    delete process.env.CLEARING_SIGNER_URL;
    process.env.CDP_API_KEY_ID = 'seller-key-id';
    process.env.CDP_API_KEY_SECRET = 'seller-key-secret';
    process.env.CLEARING_PAY_TO = PAY_TO;
    process.env.CLEARING_ALLOW_FAKE = '0';
    expect(() => assertProductionRail()).not.toThrow();
    const ctx = createContext({ persist: false, config: { allowFake: false } });
    expect(ctx.config.facilitator).toBe('cdp');
    expect(ctx.config.signer).toBe('x402_fetch');
    expect(ctx.facilitator).toBeInstanceOf(CdpFacilitator);
  });

  it('railway cdp mode passes without zigzag vars', () => {
    process.env.NODE_ENV = 'test';
    process.env.RAILWAY_ENVIRONMENT = 'production';
    process.env.CLEARING_FACILITATOR = 'cdp';
    delete process.env.CLEARING_SIGNER;
    delete process.env.CLEARING_RAIL_TOKEN;
    delete process.env.ZIGZAG_RAIL_TOKEN;
    delete process.env.CLEARING_ZIGZAG_URL;
    process.env.CDP_API_KEY_ID = 'seller-key-id';
    process.env.CDP_API_KEY_SECRET = 'seller-key-secret';
    expect(() => assertProductionRail()).not.toThrow();
  });

  it('cdp mode names exactly the missing CDP vars', () => {
    process.env.NODE_ENV = 'production';
    process.env.CLEARING_FACILITATOR = 'cdp';
    delete process.env.CLEARING_SIGNER;
    delete process.env.CLEARING_RAIL_TOKEN;
    delete process.env.ZIGZAG_RAIL_TOKEN;
    delete process.env.CLEARING_ZIGZAG_URL;
    delete process.env.CDP_API_KEY_ID;
    delete process.env.CDP_API_KEY_SECRET;
    expect(() => assertProductionRail()).toThrow(
      'production Clearing CDP facilitator requires CDP_API_KEY_ID and CDP_API_KEY_SECRET',
    );
    process.env.CDP_API_KEY_ID = 'seller-key-id';
    process.env.CDP_API_KEY_SECRET = '   ';
    expect(() => assertProductionRail()).toThrow(
      'production Clearing CDP facilitator requires CDP_API_KEY_SECRET',
    );
    delete process.env.CDP_API_KEY_ID;
    process.env.CDP_API_KEY_SECRET = 'seller-key-secret';
    expect(() => assertProductionRail()).toThrow(
      'production Clearing CDP facilitator requires CDP_API_KEY_ID',
    );
    expect(() => createFacilitator('cdp', false)).toThrow('CDP_API_KEY_ID required');
  });
});
