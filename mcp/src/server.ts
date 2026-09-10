#!/usr/bin/env node
/**
 * Clearing MCP — stdio product server (repertoire form).
 * Server name is `clearing`, never `xray-clearing`.
 */
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { createContext, type ClearingContext } from './context.js';
import { ClearingError } from './errors.js';
import { handleTool, TOOL_DEFINITIONS } from './tools.js';
import { assertConfirmCapLive } from './config.js';

export const SERVER_NAME = 'clearing';
export const SERVER_VERSION = '0.1.0';

export function createClearingServer(ctx: ClearingContext): Server {
  assertConfirmCapLive(ctx.config);
  const server = new Server({ name: SERVER_NAME, version: SERVER_VERSION }, { capabilities: { tools: {} } });

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: TOOL_DEFINITIONS.map((tool) => ({
      name: tool.name,
      description: tool.description,
      inputSchema: tool.inputSchema,
    })),
  }));

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;
    try {
      const data = await handleTool(name, (args ?? {}) as Record<string, unknown>, ctx);
      return jsonResult(data);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      const code = err instanceof ClearingError ? err.code : 'error';
      return {
        content: [{ type: 'text' as const, text: JSON.stringify({ error: message, code }, null, 2) }],
        isError: true,
      };
    }
  });

  return server;
}

function jsonResult(data: unknown) {
  return {
    content: [{ type: 'text' as const, text: JSON.stringify(data, null, 2) }],
  };
}

async function main(): Promise<void> {
  const allowFake = process.env.CLEARING_ALLOW_FAKE === '1';
  const ctx = createContext({ persist: true, config: { allowFake } });
  const server = createClearingServer(ctx);
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

const thisFile = fileURLToPath(import.meta.url);
const invoked = process.argv[1] ? resolve(process.argv[1]) : '';
if (invoked && thisFile === invoked) {
  main().catch((err) => {
    process.stderr.write(`FATAL: ${err instanceof Error ? err.message : String(err)}\n`);
    process.exit(1);
  });
}
