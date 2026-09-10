#!/usr/bin/env node
import { createContext } from '../../mcp/src/context.js';
import { createExtractHttpServer } from '../../mcp/src/http.js';
import { assertConfirmCapLive } from '../../mcp/src/config.js';

async function main(): Promise<void> {
  const allowFake = process.env.CLEARING_ALLOW_FAKE === '1';
  const ctx = createContext({ persist: true, config: { allowFake } });
  assertConfirmCapLive(ctx.config);
  const server = createExtractHttpServer(ctx);
  const port = ctx.config.extractPort;
  server.listen(port, () => {
    process.stderr.write(`clearing-extract listening on :${port}\n`);
  });
}

main().catch((err) => {
  process.stderr.write(`FATAL: ${err instanceof Error ? err.message : String(err)}\n`);
  process.exit(1);
});
