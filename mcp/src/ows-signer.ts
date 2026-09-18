/**
 * Sign EIP-3009 from local OWS (~/.ows). No leftover HTTP rail on :8789.
 * Hangar (Railway) still settles the 402.
 */
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { fail } from './errors.js';
import { encodePayload, signedFromPayload } from './x402.js';
import { isHexAddress, normalizeAddress } from './bytes.js';
import type { PaymentRequirements, SignedPayment, SignerKind } from './types.js';

type EipMod = {
  signTransferWithAuthorization: (opts: {
    walletName: string;
    to: `0x${string}`;
    valueAtomic: string;
    paymentId: string;
  }) => Promise<{
    from: `0x${string}`;
    to: `0x${string}`;
    value: string;
    validAfter: string;
    validBefore: string;
    nonce: `0x${string}`;
    signature: `0x${string}`;
  }>;
  getEVMAddress?: (name: string) => string | null;
};

function zigzagEipPath(): string | undefined {
  const here = dirname(fileURLToPath(import.meta.url));
  const envRoot = process.env.ZIGZAG_ROOT;
  const candidates = [
    envRoot ? join(envRoot, 'src/lib/eip3009.ts') : '',
    join(here, '../../../zigzag/src/lib/eip3009.ts'),
    join(homedir(), 'dev/zigzag/src/lib/eip3009.ts'),
  ].filter(Boolean);
  return candidates.find((p) => existsSync(p));
}

export function owsWalletName(): string {
  return process.env.ZIGZAG_WALLET || process.env.OWS_WALLET || 'agent-treasury-1';
}

export function isLoopbackSignerUrl(raw: string | undefined): boolean {
  if (!raw) return true;
  try {
    const u = new URL(raw.endsWith('/sign') ? raw : raw);
    return u.hostname === '127.0.0.1' || u.hostname === 'localhost' || u.hostname === '::1';
  } catch {
    return true;
  }
}

export class InProcessOwsSigner {
  readonly kind: SignerKind = 'zigzag';
  readonly addressMasked: string;
  private readonly payloads = new Map<string, string>();
  private readonly walletName: string;

  constructor(walletName = owsWalletName()) {
    this.walletName = walletName;
    this.addressMasked = `ows:${walletName}`;
  }

  async sign(input: { paymentId: string; quote: PaymentRequirements; approved?: boolean }): Promise<SignedPayment> {
    const existing = this.payloads.get(input.paymentId);
    if (existing) return signedFromPayload(existing);
    const file = zigzagEipPath();
    if (!file) {
      fail(
        'rail_missing',
        'OWS signer needs sibling zigzag (ZIGZAG_ROOT) and a funded ~/.ows wallet. No 8789 rail.',
        503,
      );
    }
    const mod = (await import(pathToFileURL(file).href)) as EipMod;
    const to = input.quote.payTo;
    if (!isHexAddress(to)) fail('x402_payload', 'quote.payTo missing', 402);
    const eip3009 = await mod.signTransferWithAuthorization({
      walletName: this.walletName,
      to: normalizeAddress(to),
      valueAtomic: input.quote.maxAmountRequired,
      paymentId: input.paymentId,
    });
    const headerValue = encodePayload({
      x402Version: 1,
      paymentId: input.paymentId,
      nonce: input.paymentId,
      accepted: input.quote,
      eip3009,
    });
    this.payloads.set(input.paymentId, headerValue);
    return signedFromPayload(headerValue);
  }
}
