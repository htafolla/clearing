import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { handleExtract } from './extract.js';
import type { ClearingContext } from './context.js';

export function createExtractHttpServer(ctx: ClearingContext) {
  return createServer((req, res) => {
    void dispatch(req, res, ctx);
  });
}

async function dispatch(req: IncomingMessage, res: ServerResponse, ctx: ClearingContext): Promise<void> {
  try {
    const request = await incomingToRequest(req, ctx.config.extractBaseUrl);
    const response = await handleExtract(request, ctx);
    res.statusCode = response.status;
    response.headers.forEach((value, key) => {
      res.setHeader(key, value);
    });
    const buf = Buffer.from(await response.arrayBuffer());
    res.end(buf);
  } catch (err) {
    res.statusCode = 500;
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ error: err instanceof Error ? err.message : 'extract failed' }));
  }
}

async function incomingToRequest(req: IncomingMessage, base: string): Promise<Request> {
  const host = req.headers.host ?? '127.0.0.1';
  const url = new URL(req.url ?? '/', `${base.startsWith('http') ? new URL(base).protocol : 'http:'}//${host}`);
  const headers = new Headers();
  for (const [key, value] of Object.entries(req.headers)) {
    if (typeof value === 'string') headers.set(key, value);
    else if (Array.isArray(value)) headers.set(key, value.join(','));
  }
  const method = req.method ?? 'GET';
  if (method === 'GET' || method === 'HEAD') {
    return new Request(url, { method, headers });
  }
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(Buffer.from(chunk));
  return new Request(url, { method, headers, body: Buffer.concat(chunks) });
}
