import { b64decodeToString, b64encode, isHexAddress, normalizeAddress } from './bytes.js';
import { fail } from './errors.js';
import { usdToAtomic } from './money.js';
import {
  BASE_CHAIN_ID,
  USDC_BASE,
  USDC_EIP712_NAME,
  USDC_EIP712_VERSION,
  type BazaarExtension,
  type HexAddress,
  type PayloadBody,
  type PaymentExtra,
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

/** EIP-712 domain for Base USDC. Forced last so ticker `USDC` cannot be advertised as `name`. */
export function baseUsdcEip712Domain(): Pick<PaymentExtra, 'name' | 'version'> {
  return { name: USDC_EIP712_NAME, version: USDC_EIP712_VERSION };
}

export function buildRequirements(opts: {
  amountUsd: number;
  payTo: HexAddress;
  resource: string;
  description: string;
  extra?: Omit<PaymentExtra, 'name' | 'version'>;
  maxTimeoutSeconds?: number;
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
    maxTimeoutSeconds: opts.maxTimeoutSeconds ?? 60,
    extra: { ...opts.extra, ...baseUsdcEip712Domain() },
  };
}

export type BazaarDiscovery = {
  queryParams: Record<string, string>;
  querySchema: Record<string, { type: 'string'; description?: string }>;
  requiredQuery: string[];
  outputExample: Record<string, unknown>;
  serviceName?: string;
  tags?: string[];
};

/**
 * Official bazaar GET shape from specs/extensions/bazaar.md (x402-foundation).
 * `info` must validate against `schema.properties.input` (CDP facilitator).
 */
export function httpGetBazaar(discovery: BazaarDiscovery): BazaarExtension {
  const queryProperties: Record<string, { type: string; description?: string }> = {};
  for (const [key, spec] of Object.entries(discovery.querySchema)) {
    queryProperties[key] = spec.description
      ? { type: spec.type, description: spec.description }
      : { type: spec.type };
  }
  return {
    info: {
      input: {
        type: 'http',
        method: 'GET',
        ...(Object.keys(discovery.queryParams).length > 0 ? { queryParams: discovery.queryParams } : {}),
      },
      output: {
        type: 'json',
        example: discovery.outputExample,
      },
    },
    schema: {
      $schema: 'https://json-schema.org/draft/2020-12/schema',
      type: 'object',
      properties: {
        input: {
          type: 'object',
          properties: {
            type: { type: 'string', const: 'http' },
            method: { type: 'string', enum: ['GET', 'HEAD', 'DELETE'] },
            queryParams: {
              type: 'object',
              properties: queryProperties,
              ...(discovery.requiredQuery.length > 0 ? { required: discovery.requiredQuery } : {}),
            },
            headers: {
              type: 'object',
              additionalProperties: { type: 'string' },
            },
          },
          required: ['type', 'method'],
          additionalProperties: false,
        },
        output: {
          type: 'object',
          properties: {
            type: { type: 'string' },
            example: { type: 'object' },
          },
          required: ['type'],
        },
      },
      required: ['input'],
    },
  };
}

export function buildQuote(
  req: PaymentRequirements,
  error = 'X-PAYMENT header is required',
  discovery?: BazaarDiscovery,
): X402Quote {
  const tags = discovery?.tags;
  return {
    x402Version: 2,
    error,
    resource: {
      url: req.resource,
      description: req.description,
      mimeType: req.mimeType,
      serviceName: discovery?.serviceName ?? 'Clearing',
      ...(tags && tags.length > 0 ? { tags } : {}),
    },
    // v2 wants `amount`; keep v1 fields so ZigZag EIP-3009 still matches PaymentRequirements.
    accepts: [{ ...req, amount: req.maxAmountRequired }],
    extensions: {
      bazaar: httpGetBazaar(
        discovery ?? {
          queryParams: {},
          querySchema: {},
          requiredQuery: [],
          outputExample: {},
        },
      ),
    },
  };
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
    const resourceUrl =
      rec.resource && typeof rec.resource === 'object' && rec.resource !== null
        ? String((rec.resource as { url?: unknown }).url ?? '')
        : '';
    const accepts = rec.accepts;
    if (Array.isArray(accepts) && accepts.length > 0) {
      return asRequirements(accepts[0], resourceUrl);
    }
    if (rec.paymentRequirements) {
      return asRequirements(rec.paymentRequirements, resourceUrl);
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

function asRequirements(raw: unknown, fallbackResource = ''): PaymentRequirements | undefined {
  if (typeof raw !== 'object' || raw === null) return undefined;
  const r = raw as Record<string, unknown>;
  const payTo = String(r.payTo ?? r.payToAddress ?? '');
  const asset = String(r.asset ?? r.usdcAddress ?? '');
  const amount = String(r.maxAmountRequired ?? r.amount ?? '');
  const resource = String(r.resource ?? fallbackResource);
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
      ...(typeof r.extra === 'object' && r.extra !== null ? (r.extra as Record<string, unknown>) : {}),
      ...baseUsdcEip712Domain(),
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
