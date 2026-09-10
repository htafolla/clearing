import { USDC_DECIMALS } from './types.js';

export function usdToAtomic(usd: number): bigint {
  if (!Number.isFinite(usd) || usd < 0) {
    throw new Error(`invalid usd: ${usd}`);
  }
  return BigInt(Math.round(usd * 10 ** USDC_DECIMALS));
}

export function atomicToUsdString(atomic: bigint): string {
  const neg = atomic < 0n;
  const abs = neg ? -atomic : atomic;
  const scale = 10n ** BigInt(USDC_DECIMALS);
  const whole = abs / scale;
  const frac = (abs % scale).toString().padStart(USDC_DECIMALS, '0').replace(/0+$/, '');
  const body = frac.length === 0 ? whole.toString() : `${whole.toString()}.${frac}`;
  return neg ? `-${body}` : body;
}

export function parseUsd(value: string | number): number {
  const n = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(n) || n < 0) {
    throw new Error(`invalid usd: ${value}`);
  }
  return n;
}

export function addUsd(a: string, b: string): string {
  return atomicToUsdString(usdToAtomic(Number(a)) + usdToAtomic(Number(b)));
}
