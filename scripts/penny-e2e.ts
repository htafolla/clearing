/**
 * Real Base USDC penny: ZigZag OWS EIP-3009 → Clearing extract.
 * Requires local zigzag rail on :8789 and clearing MCP-HTTP on :8790.
 */
const USDC = '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913';
const FROM = '0x00552afc18275c7723dad2EC95d77308738cE07e';
const TO = process.env.CLEARING_PAY_TO || '0xc9cD4E19e8fFabFC479352680295ba12e454462D';
const EXTRACT = process.env.EXTRACT_URL || 'http://127.0.0.1:8790/v1/extract?url=https://example.com/';
const RPC = 'https://mainnet.base.org';

async function usdcOf(addr: string): Promise<number> {
  const data = `0x70a08231${addr.slice(2).toLowerCase().padStart(64, '0')}`;
  const res = await fetch(RPC, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method: 'eth_call',
      params: [{ to: USDC, data }, 'latest'],
    }),
  });
  const json = (await res.json()) as { result?: string };
  return Number(BigInt(json.result || '0x0')) / 1e6;
}

async function main(): Promise<void> {
  const beforeFrom = await usdcOf(FROM);
  const beforeTo = await usdcOf(TO);
  process.stdout.write(`before from=${beforeFrom} to=${beforeTo}\n`);

  const { createContext } = await import('../mcp/src/context.js');
  const { fetchPaid } = await import('../mcp/src/pay.js');
  process.env.CLEARING_ZIGZAG_URL = process.env.CLEARING_ZIGZAG_URL || 'http://127.0.0.1:8789';
  const ctx = createContext({
    persist: true,
    config: {
      allowFake: false,
      signer: 'zigzag',
      facilitator: 'zigzag',
      payTo: TO,
      extractBaseUrl: 'http://127.0.0.1:8790',
      perTxCapUsd: 0.05,
      confirmAboveUsd: 0.001,
    },
  });
  const result = await fetchPaid({
    url: EXTRACT,
    maxUsd: 0.05,
    dryRun: false,
    approved: true,
  }, ctx);
  process.stdout.write(`${JSON.stringify({ paid: result.paid, status: result.status, txHash: result.txHash, error: result.error, code: result.code })}\n`);
  if (!result.paid) process.exit(1);
  const afterFrom = await usdcOf(FROM);
  const afterTo = await usdcOf(TO);
  process.stdout.write(`after from=${afterFrom} to=${afterTo} tx=${result.txHash}\n`);
  if (!(afterFrom < beforeFrom) || !(afterTo > beforeTo)) {
    process.stderr.write('USDC balances did not move on Base\n');
    process.exit(1);
  }
}

main().catch((err) => {
  process.stderr.write(`${err instanceof Error ? err.message : String(err)}\n`);
  process.exit(1);
});
