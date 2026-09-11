import { AwalSigner } from './awal.js';
import { fail } from './errors.js';
import { encodePayload, signedFromPayload } from './x402.js';
import type { PaymentRequirements, SignedPayment, SignerKind } from './types.js';

export interface Signer {
  readonly kind: SignerKind;
  readonly addressMasked: string;
  sign(input: { paymentId: string; quote: PaymentRequirements }): Promise<SignedPayment>;
  /** Coinbase awal: pay the 402 URL in-process. Clearing still gated. */
  payThrough?(input: { url: string; maxAtomic: string }): Promise<{
    status: number;
    body: unknown;
    txHash?: `0x${string}`;
  }>;
}

/**
 * Test/dev signer. paymentId maps 1:1 to payload bytes. Never re-signs.
 */
export class FakeSigner implements Signer {
  readonly kind = 'fake' as const;
  readonly addressMasked = '0xfake…sig';
  private readonly payloads = new Map<string, string>();
  signCount = 0;

  async sign(input: { paymentId: string; quote: PaymentRequirements }): Promise<SignedPayment> {
    const existing = this.payloads.get(input.paymentId);
    if (existing) return signedFromPayload(existing);
    const payload = encodePayload({
      x402Version: 1,
      paymentId: input.paymentId,
      nonce: input.paymentId,
      accepted: input.quote,
    });
    this.payloads.set(input.paymentId, payload);
    this.signCount += 1;
    return signedFromPayload(payload);
  }
}

export class MissingRailSigner implements Signer {
  readonly addressMasked = 'unconfigured';
  constructor(readonly kind: SignerKind) {}
  async sign(): Promise<SignedPayment> {
    fail('rail_missing', `signer rail ${this.kind} is not configured; keys stay on the rail`, 503);
  }
}

export class HttpRailSigner implements Signer {
  readonly addressMasked = 'rail…daemon';
  private readonly payloads = new Map<string, string>();
  constructor(
    readonly kind: SignerKind,
    private readonly url: string,
    private readonly fetchFn: typeof fetch,
  ) {}

  async sign(input: { paymentId: string; quote: PaymentRequirements }): Promise<SignedPayment> {
    const existing = this.payloads.get(input.paymentId);
    if (existing) return signedFromPayload(existing);
    const token = process.env.CLEARING_RAIL_TOKEN || process.env.ZIGZAG_RAIL_TOKEN;
    const headers: Record<string, string> = { 'content-type': 'application/json' };
    if (token) headers.authorization = `Bearer ${token}`;
    const res = await this.fetchFn(this.url, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        paymentId: input.paymentId,
        quote: input.quote,
        approved: true,
      }),
    });
    if (!res.ok) fail('rail_missing', `signer daemon ${res.status}`, 503);
    const json = (await res.json()) as { headerValue?: string };
    if (typeof json.headerValue !== 'string') fail('rail_missing', 'signer daemon returned no payload', 503);
    this.payloads.set(input.paymentId, json.headerValue);
    return signedFromPayload(json.headerValue);
  }
}

export function createSigner(
  kind: SignerKind,
  allowFake: boolean,
  opts: { signerUrl?: string; fetchFn?: typeof fetch } = {},
): Signer {
  if (kind === 'awal' || kind === 'coinbase') {
    return new AwalSigner(kind);
  }
  if (kind === 'zigzag') {
    const raw = opts.signerUrl ?? process.env.CLEARING_ZIGZAG_URL ?? process.env.CLEARING_SIGNER_URL;
    if (!raw) fail('rail_missing', 'CLEARING_ZIGZAG_URL or CLEARING_SIGNER_URL required for zigzag signer', 503);
    const url = raw.endsWith('/sign') ? raw : `${raw.replace(/\/$/, '')}/sign`;
    return new HttpRailSigner('zigzag', url, opts.fetchFn ?? fetch);
  }
  if (opts.signerUrl) {
    return new HttpRailSigner(kind, opts.signerUrl, opts.fetchFn ?? fetch);
  }
  if (kind === 'fake') {
    if (!allowFake) {
      fail('rail_missing', 'fake signer is disabled (set CLEARING_ALLOW_FAKE=1)', 503);
    }
    return new FakeSigner();
  }
  return new MissingRailSigner(kind);
}
