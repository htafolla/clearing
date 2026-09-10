import { fail } from './errors.js';
import { encodePayload, signedFromPayload } from './x402.js';
import type { PaymentRequirements, SignedPayment, SignerKind } from './types.js';

export interface Signer {
  readonly kind: SignerKind;
  readonly addressMasked: string;
  sign(input: { paymentId: string; quote: PaymentRequirements }): Promise<SignedPayment>;
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
    const res = await this.fetchFn(this.url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ paymentId: input.paymentId, quote: input.quote }),
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
  if (opts.signerUrl) {
    return new HttpRailSigner(kind, opts.signerUrl, opts.fetchFn ?? fetch);
  }
  if (kind === 'fake') {
    if (!allowFake || process.env.NODE_ENV === 'production') {
      fail('rail_missing', 'fake signer is disabled (set CLEARING_ALLOW_FAKE=1 for local)', 503);
    }
    return new FakeSigner();
  }
  return new MissingRailSigner(kind);
}
