import { afterEach, describe, expect, it } from 'vitest';
import { assertProductionRail } from '../mcp/src/production-rail.js';

describe('assertProductionRail', () => {
  const keys = ['NODE_ENV', 'RAILWAY_ENVIRONMENT', 'CLEARING_SIGNER', 'CLEARING_RAIL_TOKEN', 'ZIGZAG_RAIL_TOKEN'] as const;
  const prev: Record<string, string | undefined> = {};

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
    process.env.CLEARING_SIGNER = 'fake';
    delete process.env.CLEARING_RAIL_TOKEN;
    delete process.env.ZIGZAG_RAIL_TOKEN;
    expect(() => assertProductionRail()).toThrow(/CLEARING_SIGNER=zigzag/);
  });

  it('passes in production with zigzag and token', () => {
    process.env.NODE_ENV = 'production';
    process.env.CLEARING_SIGNER = 'zigzag';
    process.env.CLEARING_RAIL_TOKEN = 't';
    expect(() => assertProductionRail()).not.toThrow();
  });
});
