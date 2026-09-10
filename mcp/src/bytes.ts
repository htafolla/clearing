import { createHash, randomUUID } from 'node:crypto';

export function sha256Hex(data: string | Uint8Array): string {
  const hash = createHash('sha256');
  hash.update(data);
  return hash.digest('hex');
}

export function textHash(data: string): string {
  return `sha256:${sha256Hex(data)}`;
}

export function utf8(data: string): Uint8Array {
  return new TextEncoder().encode(data);
}

export function b64encode(data: string | Uint8Array): string {
  const buf = typeof data === 'string' ? Buffer.from(data, 'utf8') : Buffer.from(data);
  return buf.toString('base64');
}

export function b64decodeToString(value: string): string {
  return Buffer.from(value, 'base64').toString('utf8');
}

export function newPaymentId(): string {
  return randomUUID();
}

export function isHexAddress(value: string): value is `0x${string}` {
  return /^0x[a-fA-F0-9]{40}$/.test(value);
}

export function normalizeAddress(value: string): `0x${string}` {
  if (!isHexAddress(value)) {
    throw new Error(`invalid address: ${value}`);
  }
  return `0x${value.slice(2).toLowerCase()}` as `0x${string}`;
}
