/**
 * Streamable HTTP MCP — same shape as Groover registry and Dynamo:
 *   GET  /health  GET /  GET /mcp
 *   POST /mcp     POST /
 * Stdio remains mcp/src/server.ts. Not an xray-* server.
 */
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { createContext } from './context.js';
import { dispatch, isExtractPath } from './http.js';
import { handleTool, TOOL_DEFINITIONS } from './tools.js';
import { assertProductionRail } from './production-rail.js';
import { hydrateSettlementsFromChain } from './settlement-chain.js';

const PORT = parseInt(process.env.PORT || '3000', 10);
const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
};

type Rpc = {
  jsonrpc?: string;
  id?: string | number | null;
  method?: string;
  params?: { name?: string; arguments?: Record<string, unknown> };
};

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on('data', (c: Buffer) => chunks.push(c));
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

function sendJson(res: ServerResponse, code: number, body: unknown): void {
  res.writeHead(code, { 'Content-Type': 'application/json', ...CORS });
  res.end(JSON.stringify(body));
}

async function handleMcp(
  rpc: Rpc,
  ctx: ReturnType<typeof createContext>,
  authHeader: string,
): Promise<unknown> {
  if (rpc.method === 'initialize') {
    return {
      jsonrpc: '2.0',
      id: rpc.id ?? 1,
      result: {
        protocolVersion: '2024-11-05',
        serverInfo: { name: 'clearing', version: '0.1.0' },
        capabilities: { tools: {} },
      },
    };
  }
  if (rpc.method === 'tools/list' || rpc.method === 'notifications/initialized') {
    if (rpc.method === 'notifications/initialized') return null;
    return { jsonrpc: '2.0', id: rpc.id ?? 1, result: { tools: TOOL_DEFINITIONS } };
  }
  if (rpc.method === 'tools/call') {
    const name = rpc.params?.name || '';
    const args = rpc.params?.arguments ?? {};
    const liveSpend = name === 'fetch_paid' && args.dryRun === false && args.approved === true;
    if (liveSpend) {
      const token = (process.env.CLEARING_OPERATOR_TOKEN || process.env.CLEARING_RAIL_TOKEN || '').trim();
      if (!token || authHeader !== `Bearer ${token}`) {
        return { jsonrpc: '2.0', id: rpc.id ?? 1, error: { message: 'unauthorized' } };
      }
    }
    const data = await handleTool(name, args, ctx);
    return {
      jsonrpc: '2.0',
      id: rpc.id ?? 1,
      result: { content: [{ type: 'text', text: JSON.stringify(data) }] },
    };
  }
  return {
    jsonrpc: '2.0',
    id: rpc.id ?? 1,
    error: { code: -32601, message: `unknown method ${rpc.method ?? ''}` },
  };
}

async function main(): Promise<void> {
  assertProductionRail();
  const hosted = Boolean(process.env.RAILWAY_ENVIRONMENT) || process.env.NODE_ENV === 'production';
  const publicBase =
    process.env.CLEARING_PUBLIC_URL ||
    process.env.CLEARING_EXTRACT_BASE_URL ||
    `http://127.0.0.1:${PORT}`;
  const boot = createContext({
    persist: true,
    config: {
      allowFake: !hosted && process.env.CLEARING_ALLOW_FAKE === '1',
      extractBaseUrl: publicBase,
    },
  });
  const server = createServer((req, res) => {
    void (async () => {
      const url = req.url?.split('?')[0] ?? '/';
      if (req.method === 'OPTIONS') {
        res.writeHead(204, { ...CORS, 'Access-Control-Max-Age': '86400' });
        res.end();
        return;
      }
      if (req.method === 'GET' && (url === '/' || url === '/health')) {
        sendJson(res, 200, {
          status: 'healthy',
          server: 'clearing',
          version: '0.1.0',
          tools: TOOL_DEFINITIONS.length,
          signer: boot.config.signer,
        });
        return;
      }
      if (req.method === 'GET' && url === '/mcp') {
        sendJson(res, 200, {
          protocol: 'mcp',
          version: '0.1.0',
          transport: 'streamable-http',
          tools: TOOL_DEFINITIONS.map((t) => t.name),
        });
        return;
      }
      if (req.method === 'POST' && (url === '/mcp' || url === '/')) {
        const parsed = JSON.parse((await readBody(req)) || '{}') as Rpc;
        const result = await handleMcp(parsed, boot, String(req.headers.authorization || ''));
        if (!result) {
          res.writeHead(202, CORS);
          res.end();
          return;
        }
        sendJson(res, 200, result);
        return;
      }
      if (isExtractPath(url)) {
        await dispatch(req, res, boot);
        return;
      }
      sendJson(res, 404, { error: 'not found' });
    })().catch((err) => {
      sendJson(res, 500, { error: err instanceof Error ? err.message : String(err) });
    });
  });
  server.listen(PORT, '0.0.0.0', () => {
    process.stdout.write(`clearing MCP streamable-http :${PORT}\n`);
  });
  void hydrateSettlementsFromChain(boot)
    .then((n) => {
      process.stdout.write(`clearing hydrated ${n} on-chain USDC settlements\n`);
    })
    .catch((err) => {
      process.stderr.write(
        `clearing chain hydrate failed: ${err instanceof Error ? err.message : String(err)}\n`,
      );
    });
}

void main();
