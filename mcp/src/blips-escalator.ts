/**
 * Blips price escalator — LOCKED (Blaze 2026-09-15).
 * SSOT: hangar-magnet/ops/blips/PRICE-ESCALATOR.md
 *
 *   price¢ = max(5, round(5 + 550 * (mintIndex/555)**2))
 *
 * Quadratic ease-in (steepens). mintIndex 0 → 5¢ · mintIndex 555 → 555¢ ($5.55).
 * NOT the rejected flat `5 + floor(mintIndex/100)`.
 *
 * mintIndex = hangar settled paid Blip count (= collection totalSupply when the
 * NFT is configured). The mint being purchased is quoted at that index.
 */
export const BLIPS_ESCALATOR_FORMULA = 'max(5, round(5 + 550 * (mintIndex/555)**2))';
export const BLIPS_ESCALATOR_KIND = 'quadratic-ease-in';
export const BLIPS_START_CENTS = 5;
export const BLIPS_ANCHOR_INDEX = 555;
export const BLIPS_ANCHOR_CENTS = 555;

export function blipPriceCents(mintIndex: number): number {
  if (!Number.isInteger(mintIndex) || mintIndex < 0) {
    throw new Error(`mintIndex must be a non-negative integer, got ${mintIndex}`);
  }
  const t = mintIndex / BLIPS_ANCHOR_INDEX;
  return Math.max(BLIPS_START_CENTS, Math.round(BLIPS_START_CENTS + 550 * t * t));
}

export function blipPriceUsd(mintIndex: number): number {
  return blipPriceCents(mintIndex) / 100;
}

export function rejectedFlatCents(mintIndex: number): number {
  return 5 + Math.floor(mintIndex / 100);
}

export type BlipsQuoteMeta = {
  skill: 'blip';
  mintIndex: number;
  priceCents: number;
  escalator: typeof BLIPS_ESCALATOR_KIND;
  formula: typeof BLIPS_ESCALATOR_FORMULA;
  priceFinal: true;
  signer: 'zigzag';
  mintIndexSource: 'settledPaid';
};
