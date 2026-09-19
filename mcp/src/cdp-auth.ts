/**
 * CDP Secret API Key JWT (Ed25519 or ES256). Never log the secret.
 */
import { createPrivateKey, randomBytes, sign } from 'node:crypto';

export const CDP_X402_HOST = 'api.cdp.coinbase.com';
export const CDP_VERIFY_PATH = '/platform/v2/x402/verify';
export const CDP_SETTLE_PATH = '/platform/v2/x402/settle';
export const CDP_SETTLE_URL = `https://${CDP_X402_HOST}${CDP_SETTLE_PATH}`;
export const CDP_VERIFY_URL = `https://${CDP_X402_HOST}${CDP_VERIFY_PATH}`;
export const CDP_SEARCH_URL = `https://${CDP_X402_HOST}/platform/v2/x402/discovery/search`;

export function hasCdpKeys(): boolean {
  return Boolean(process.env.CDP_API_KEY_ID?.trim() && process.env.CDP_API_KEY_SECRET?.trim());
}

export function cdpBearerJwt(opts: {
  apiKeyId: string;
  apiKeySecret: string;
  method: string;
  host: string;
  path: string;
}): string {
  const id = opts.apiKeyId.trim();
  const secret = opts.apiKeySecret.trim().replace(/\\n/g, '\n');
  if (!id || !secret) {
    throw new Error('cdp keys missing');
  }
  const now = Math.floor(Date.now() / 1000);
  const nonce = randomBytes(16).toString('hex');
  const claims = {
    sub: id,
    iss: 'cdp',
    aud: ['cdp_service'],
    nbf: now,
    exp: now + 120,
    uri: `${opts.method} ${opts.host}${opts.path}`,
  };
  if (secret.includes('BEGIN')) {
    return signJwt(
      { alg: 'ES256', typ: 'JWT', kid: id, nonce },
      claims,
      (input) => {
        const key = createPrivateKey(secret);
        return sign('sha256', Buffer.from(input), { key, dsaEncoding: 'ieee-p1363' });
      },
    );
  }
  const decoded = Buffer.from(secret, 'base64');
  if (decoded.length !== 64) {
    throw new Error('cdp secret must be EC PEM or 64-byte Ed25519');
  }
  const seed = decoded.subarray(0, 32);
  const pub = decoded.subarray(32);
  const key = createPrivateKey({
    key: {
      kty: 'OKP',
      crv: 'Ed25519',
      d: seed.toString('base64url'),
      x: pub.toString('base64url'),
    },
    format: 'jwk',
  });
  return signJwt({ alg: 'EdDSA', typ: 'JWT', kid: id, nonce }, claims, (input) =>
    sign(null, Buffer.from(input), key),
  );
}

function signJwt(
  header: Record<string, string>,
  claims: Record<string, unknown>,
  signer: (input: string) => Buffer,
): string {
  const input = `${b64urlJson(header)}.${b64urlJson(claims)}`;
  return `${input}.${signer(input).toString('base64url')}`;
}

function b64urlJson(value: unknown): string {
  return Buffer.from(JSON.stringify(value)).toString('base64url');
}
