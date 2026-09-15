import { describe, expect, it } from 'vitest';
import {
  BLIPS_ESCALATOR_FORMULA,
  blipPriceCents,
  blipPriceUsd,
  rejectedFlatCents,
} from '../mcp/src/blips-escalator.js';

describe('Blips escalator LOCKED quadratic', () => {
  it('mintIndex 0 → 5¢ and mintIndex 555 → 555¢', () => {
    expect(blipPriceCents(0)).toBe(5);
    expect(blipPriceUsd(0)).toBe(0.05);
    expect(blipPriceCents(555)).toBe(555);
    expect(blipPriceUsd(555)).toBe(5.55);
  });

  it('steepens (quadratic ease-in) and is not the rejected flat schedule', () => {
    expect(BLIPS_ESCALATOR_FORMULA).toBe('max(5, round(5 + 550 * (mintIndex/555)**2))');
    expect(blipPriceCents(100)).toBe(23);
    expect(rejectedFlatCents(100)).toBe(6);
    expect(blipPriceCents(100)).not.toBe(rejectedFlatCents(100));
    expect(blipPriceCents(200)).toBeGreaterThan(blipPriceCents(100));
    const early = blipPriceCents(100) - blipPriceCents(0);
    const late = blipPriceCents(500) - blipPriceCents(400);
    expect(late).toBeGreaterThan(early);
  });

  it('rejects negative mintIndex', () => {
    expect(() => blipPriceCents(-1)).toThrow(/mintIndex/);
  });
});
