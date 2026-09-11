/**
 * Coinbase Agentic Wallet (`npx awal`) as a Clearing rail.
 * awal x402 pay handles 402 internally. Keys stay in Coinbase TEE.
 * Clearing still gates caps / origin / dry_run / approved.
 */
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fail } from './errors.js';
import type { HexAddress, SignedPayment } from './types.js';
import type { Signer } from './signer.js';

const execFileAsync = promisify(execFile);

export type AwalRun = (args: string[]) => Promise<{ stdout: string; stderr: string }>;

export type AwalPayResult = {
  status: number;
  body: unknown;
  txHash?: HexAddress;
};

export function parseAwalJson(stdout: string): unknown {
  const start = stdout.indexOf('{');
  if (start < 0) fail('rail_missing', 'awal returned no JSON', 502);
  return JSON.parse(stdout.slice(start)) as unknown;
}

export async function defaultAwalRun(args: string[]): Promise<{ stdout: string; stderr: string }> {
  const bin = process.env.CLEARING_AWAL_BIN?.trim() || 'npx';
  const prefix = (process.env.CLEARING_AWAL_PREFIX ?? '--yes awal@2.12.1').split(/\s+/).filter(Boolean);
  const timeoutMs = Number(process.env.CLEARING_AWAL_TIMEOUT_MS ?? 60_000);
  try {
    const { stdout, stderr } = await execFileAsync(bin, [...prefix, ...args], {
      timeout: Number.isFinite(timeoutMs) ? timeoutMs : 60_000,
      maxBuffer: 2_000_000,
      encoding: 'utf8',
    });
    return { stdout, stderr };
  } catch (err) {
    const e = err as { stdout?: string; stderr?: string; message?: string };
    if (typeof e.stdout === 'string' && e.stdout.includes('{')) {
      return { stdout: e.stdout, stderr: e.stderr ?? '' };
    }
    fail('rail_missing', e.message ?? 'awal exec failed', 503);
  }
}

export class AwalSigner implements Signer {
  readonly addressMasked = 'awal…cdp';

  constructor(
    readonly kind: 'awal' | 'coinbase' = 'awal',
    private readonly run: AwalRun = defaultAwalRun,
  ) {}

  async sign(): Promise<SignedPayment> {
    fail('rail_missing', 'awal does not export EIP-3009; Clearing uses x402 pay-through', 501);
  }

  async payThrough(input: { url: string; maxAtomic: string }): Promise<AwalPayResult> {
    const { stdout } = await this.run([
      'x402',
      'pay',
      input.url,
      '--max-amount',
      input.maxAtomic,
      '--json',
    ]);
    const parsed = parseAwalJson(stdout);
    if (!parsed || typeof parsed !== 'object') fail('rail_missing', 'awal pay returned empty', 502);
    const rec = parsed as {
      success?: boolean;
      status?: number;
      error?: { code?: string; message?: string };
      body?: unknown;
      txHash?: string;
      payment?: { txHash?: string };
    };
    if (rec.success === false || rec.error) {
      const code = rec.error?.code ?? 'AWAL_ERROR';
      const msg = rec.error?.message ?? 'awal pay failed';
      if (code === 'AUTH_REQUIRED') {
        fail('rail_missing', 'awal AUTH_REQUIRED: npx awal auth login <email>', 401);
      }
      fail('rail_missing', `awal ${code}: ${msg}`, 502);
    }
    const tx =
      rec.txHash?.startsWith('0x')
        ? (rec.txHash as HexAddress)
        : rec.payment?.txHash?.startsWith('0x')
          ? (rec.payment.txHash as HexAddress)
          : undefined;
    return {
      status: typeof rec.status === 'number' ? rec.status : 200,
      body: rec.body ?? parsed,
      txHash: tx,
    };
  }
}
