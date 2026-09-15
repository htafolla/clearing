#!/usr/bin/env node
/**
 * After 0xray garment postinstall, keep seven xray-* (+ optional repertoire)
 * and add product MCP `clearing`. Never `xray-clearing`.
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const path = join(process.cwd(), '.mcp.json');
if (!existsSync(path)) process.exit(0);
const json = JSON.parse(readFileSync(path, 'utf8'));
if (!json.mcpServers || typeof json.mcpServers !== 'object') process.exit(0);
if (json.mcpServers.clearing) process.exit(0);
if (json.mcpServers['xray-clearing']) {
  delete json.mcpServers['xray-clearing'];
}
json.mcpServers.clearing = {
  command: 'node',
  args: ['dist/mcp/src/server.js'],
  env: {
    CLEARING_ALLOW_FAKE: '1',
    CLEARING_SIGNER: 'fake',
    CLEARING_FACILITATOR: 'memory',
  },
};
writeFileSync(path, `${JSON.stringify(json, null, 2)}\n`);
