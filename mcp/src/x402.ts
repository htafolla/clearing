import { b64decodeToString, b64encode, isHexAddress, normalizeAddress } from './bytes.js';
import { fail } from './errors.js';
import { usdToAtomic } from './money.js';
import {
  BASE_CHAIN_ID,
  USDC_BASE,
  type HexAddress,
  type PayloadBody,
  type PaymentRequirements,
  type SignedPayment,
  type X402Quote,
} from './types.js';

export const V1_PAYMENT_HEADER = 'X-PAYMENT';
export const V1_PAYMENT_HEADER_ALT = 'X-PAYMENT';
export const V2_REQUIRED_HEADER = 'PAYMENT-REQUIRED';
export const V2_SIGNATURE_HEADER = 'PAYMENT-SIGNATURE';

export function quoteUsdToAtomic(usd: number): string {
  return usdToAtomic(usd).toString();
}

export function atomicToUsd(atomic: string): number {
  return Number(atomic) / 1_000_000;
}

export function buildRequirements(opts: {
  amountUsd: number;
  payTo: HexAddress;
  resource: string;
  description: string;
  extra?: Omit<import('./types.js').PaymentExtra, 'name' | 'version'>;
}): PaymentRequirements {
  return {
    scheme: 'exact',
    network: 'eip155:8453',
    maxAmountRequired: quoteUsdToAtomic(opts.amountUsd),
    asset: USDC_BASE,
    payTo: normalizeAddress(opts.payTo),
    resource: opts.resource,
    description: opts.description,
    mimeType: 'application/json',
    maxTimeoutSeconds: 60,
    extra: { name: 'USDC', version: '2', ...opts.extra },
  };
}

export function buildQuote(req: PaymentRequirements, error = 'X-PAYMENT header is required'): X402Quote {
  return { x402Version: 1, error, accepts: [req] };
}

export function encodePayload(body: PayloadBody): string {
  return b64encode(JSON.stringify(body));
}

export function decodePayload(headerValue: string): PayloadBody {
  let parsed: unknown;
  try {
    parsed = JSON.parse(b64decodeToString(headerValue));
  } catch {
    fail('x402_payload', 'payment header is not base64 json', 402);
  }
  if (typeof parsed !== 'object' || parsed === null) {
    fail('x402_payload', 'payment payload is not an object', 402);
  }
  const body = parsed as Partial<PayloadBody>;
  if (body.x402Version !== 1 || typeof body.paymentId !== 'string' || typeof body.nonce !== 'string') {
    fail('x402_payload', 'payment payload missing paymentId/nonce', 402);
  }
  if (!body.accepted || typeof body.accepted !== 'object') {
    fail('x402_payload', 'payment payload missing accepted requirements', 402);
  }
  return body as PayloadBody;
}

export function parseQuote(body: unknown, headers?: Headers): PaymentRequirements | undefined {
  if (typeof body === 'object' && body !== null) {
    const rec = body as Record<string, unknown>;
    const accepts = rec.accepts;
    if (Array.isArray(accepts) && accepts.length > 0) {
      return asRequirements(accepts[0]);
    }
    if (rec.paymentRequirements) {
      return asRequirements(rec.paymentRequirements);
    }
  }
  if (headers) {
    const required = headers.get(V2_REQUIRED_HEADER) ?? headers.get('PAYMENT-REQUIRED');
    if (required) {
      try {
        const decoded = JSON.parse(b64decodeToString(required)) as X402Quote;
        return parseQuote(decoded);
      } catch {
        return undefined;
      }
    }
  }
  return undefined;
}

function asRequirements(raw: unknown): PaymentRequirements | undefined {
  if (typeof raw !== 'object' || raw === null) return undefined;
  const r = raw as Record<string, unknown>;
  const payTo = String(r.payTo ?? r.payToAddress ?? '');
  const asset = String(r.asset ?? r.usdcAddress ?? '');
  const amount = String(r.maxAmountRequired ?? r.amount ?? '');
  const resource = String(r.resource ?? '');
  const network = String(r.network ?? '');
  if (!isHexAddress(payTo) || !amount) return undefined;
  if (asset && normalizeAddress(asset) !== USDC_BASE.toLowerCase()) {
    return undefined;
  }
  if (network && network !== 'eip155:8453' && network !== 'base' && network !== String(BASE_CHAIN_ID)) {
    return undefined;
  }
  return {
    scheme: 'exact',
    network: 'eip155:8453',
    maxAmountRequired: amount,
    asset: USDC_BASE,
    payTo: normalizeAddress(payTo),
    resource,
    description: String(r.description ?? ''),
    mimeType: 'application/json',
    maxTimeoutSeconds: Number(r.maxTimeoutSeconds ?? 60),
    extra: {
      name: 'USDC',
      version: '2',
      ...(typeof r.extra === 'object' && r.extra !== null ? (r.extra as Record<string, unknown>) : {}),
    } as PaymentRequirements['extra'],
  };
}

export function paymentHeaderFromRequest(headers: Headers): string | undefined {
  return (
    headers.get(V1_PAYMENT_HEADER) ??
    headers.get('x-payment') ??
    headers.get(V2_SIGNATURE_HEADER) ??
    headers.get('payment-signature') ??
    undefined
  );
}

export function quoteHeaders(quote: X402Quote): Record<string, string> {
  return {
    'Content-Type': 'application/json',
    [V2_REQUIRED_HEADER]: b64encode(JSON.stringify(quote)),
    'WWW-Authenticate': 'x402',
  };
}

export function signedFromPayload(payloadB64: string): SignedPayment {
  const body = decodePayload(payloadB64);
  return {
    paymentId: body.paymentId,
    headerName: V1_PAYMENT_HEADER,
    headerValue: payloadB64,
    payloadBytes: Buffer.from(payloadB64, 'base64'),
    nonce: body.nonce,
    quote: body.accepted,
  };
}

export function requirementsMatch(got: PayloadBody, expected: PaymentRequirements): boolean {
  return (
    got.accepted.scheme === 'exact' &&
    got.accepted.network === 'eip155:8453' &&
    got.accepted.maxAmountRequired === expected.maxAmountRequired &&
    normalizeAddress(got.accepted.payTo) === normalizeAddress(expected.payTo) &&
    normalizeAddress(got.accepted.asset) === normalizeAddress(expected.asset)
  );
}
