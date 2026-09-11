/**
 * Hydrate discover settlements from live Base USDC Transfer logs to payTo.
 * Railway disks are ephemeral; on-chain receipts survive redeploy.
 */
import { isHexAddress, normalizeAddress } from './bytes.js';
import { atomicToUsdString } from './money.js';
import { USDC_BASE, type HexAddress, type Transfer } from './types.js';
import type { ClearingContext } from './context.js';

const TRANSFER_TOPIC = '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef';
const DEFAULT_RPCS = [
  'https://mainnet.base.org',
  'https://1rpc.io/base',
  'https://base.drpc.org',
  'https://base-rpc.publicnode.com',
  'https://base.llamarpc.com',
];
const CHUNK = 8_000;
const LOOKBACK_SECONDS = 7 * 24 * 60 * 60;
const BLOCK_SECONDS = 2;

type RpcLog = {
  address?: string;
  topics?: string[];
  data?: string;
  transactionHash?: string;
  blockNumber?: string;
};

export function rpcUrls(): string[] {
  const extra = process.env.CLEARING_RPC_URL?.trim();
  return extra ? [extra, ...DEFAULT_RPCS] : DEFAULT_RPCS;
}

export async function hydrateSettlementsFromChain(ctx: ClearingContext): Promise<number> {
  const latestHex = (await rpc(ctx, 'eth_blockNumber', [])) as string;
  const latest = Number.parseInt(latestHex, 16);
  if (!Number.isFinite(latest) || latest <= 0) return 0;
  const lookbackBlocks = Math.ceil(LOOKBACK_SECONDS / BLOCK_SECONDS);
  const fromBlock = Math.max(0, latest - lookbackBlocks);
  const toTopic = topicAddress(ctx.config.payTo);
  let added = 0;
  const blockTime = new Map<number, string>();

  for (let end = latest; end >= fromBlock; end -= CHUNK) {
    const start = Math.max(fromBlock, end - CHUNK + 1);
    let logs: RpcLog[] = [];
    try {
      const raw = await rpc(ctx, 'eth_getLogs', [
        {
          fromBlock: hexQty(start),
          toBlock: hexQty(end),
          address: USDC_BASE,
          topics: [TRANSFER_TOPIC, null, toTopic],
        },
      ]);
      logs = Array.isArray(raw) ? (raw as RpcLog[]) : [];
    } catch (err) {
      process.stderr.write(
        `clearing getLogs ${start}-${end} failed: ${err instanceof Error ? err.message : String(err)}\n`,
      );
      continue;
    }
    for (const log of logs) {
      const transfer = await transferFromLog(ctx, log, blockTime);
      if (!transfer) continue;
      const before = ctx.settlements.transfersTo(ctx.config.payTo, '1970-01-01T00:00:00.000Z').length;
      ctx.settlements.add(transfer);
      const after = ctx.settlements.transfersTo(ctx.config.payTo, '1970-01-01T00:00:00.000Z').length;
      if (after > before) added += 1;
    }
  }
  return added;
}

async function transferFromLog(
  ctx: ClearingContext,
  log: RpcLog,
  blockTime: Map<number, string>,
): Promise<Transfer | undefined> {
  const txHash = log.transactionHash;
  const topics = log.topics ?? [];
  if (!txHash?.startsWith('0x') || topics.length < 3 || !log.data) return undefined;
  const from = addressFromTopic(topics[1] ?? '');
  const to = addressFromTopic(topics[2] ?? '');
  if (!from || !to) return undefined;
  const amount = BigInt(log.data);
  const blockNum = Number.parseInt(log.blockNumber ?? '0x0', 16);
  const at = await timestampForBlock(ctx, blockNum, blockTime);
  return {
    from,
    to,
    amountUsd: atomicToUsdString(amount),
    at,
    txHash: txHash as HexAddress,
    tag: 'external',
  };
}

async function timestampForBlock(
  ctx: ClearingContext,
  blockNum: number,
  cache: Map<number, string>,
): Promise<string> {
  const cached = cache.get(blockNum);
  if (cached) return cached;
  const block = (await rpc(ctx, 'eth_getBlockByNumber', [hexQty(blockNum), false])) as {
    timestamp?: string;
  };
  const ts = Number.parseInt(block?.timestamp ?? '0x0', 16);
  const iso = Number.isFinite(ts) && ts > 0 ? new Date(ts * 1000).toISOString() : ctx.now().toISOString();
  cache.set(blockNum, iso);
  return iso;
}

async function rpc(ctx: ClearingContext, method: string, params: unknown[]): Promise<unknown> {
  let last = 'no rpc';
  for (const url of rpcUrls()) {
    try {
      const res = await ctx.fetch(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
        signal: AbortSignal.timeout(ctx.config.fetchTimeoutMs),
      });
      if (!res.ok) {
        last = `${url} http ${res.status}`;
        continue;
      }
      const body = (await res.json()) as { result?: unknown; error?: { message?: string } };
      if (body.error) {
        last = body.error.message ?? 'rpc error';
        continue;
      }
      return body.result;
    } catch (err) {
      last = err instanceof Error ? err.message : String(err);
    }
  }
  throw new Error(last);
}

function hexQty(n: number): string {
  return `0x${n.toString(16)}`;
}

function topicAddress(addr: HexAddress): string {
  return `0x${addr.slice(2).toLowerCase().padStart(64, '0')}`;
}

function addressFromTopic(topic: string): HexAddress | undefined {
  if (!topic || topic.length < 42) return undefined;
  const raw = `0x${topic.slice(-40)}`;
  return isHexAddress(raw) ? normalizeAddress(raw) : undefined;
}
