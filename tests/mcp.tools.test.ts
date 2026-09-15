import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { SERVER_NAME } from '../mcp/src/server.js';
import { canonicalToolName, handleTool, TOOL_DEFINITIONS, TOOL_NAMES } from '../mcp/src/tools.js';
import { assertConfirmCapLive, defaultConfig } from '../mcp/src/config.js';
import { ClearingError } from '../mcp/src/errors.js';
import { makeCtx } from './helpers.js';

describe('MCP product surface', () => {
  it('server is named clearing, never xray-clearing', () => {
    expect(SERVER_NAME).toBe('clearing');
    expect(SERVER_NAME.startsWith('xray-')).toBe(false);
  });

  it('tools are unprefixed; Grok namespaces as clearing__*', () => {
    expect(TOOL_NAMES).toEqual(['status', 'discover', 'extract', 'fetch_paid', 'receipts', 'blip']);
    for (const name of TOOL_NAMES) {
      expect(name.includes('__')).toBe(false);
      expect(canonicalToolName(`clearing__${name}`)).toBe(name);
    }
  });

  it('status has no side effects and masks addresses', async () => {
    const ctx = makeCtx();
    const status = (await handleTool('clearing__status', {}, ctx)) as {
      signer: string;
      payToMasked: string;
      remainingSessionUsd: number;
    };
    expect(status.signer).toBe('fake');
    expect(status.payToMasked).toContain('…');
    expect(status.payToMasked).not.toContain('0000000000000402');
    expect(status.remainingSessionUsd).toBe(5);
  });

  it('unknown tool errors', async () => {
    const ctx = makeCtx();
    await expect(handleTool('xray-clearing', {}, ctx)).rejects.toBeInstanceOf(ClearingError);
  });

  it('confirmAboveUsd is at or below perTxCapUsd so Plan Mode can fire', () => {
    const cfg = defaultConfig({ allowFake: true, payTo: '0x0000000000000000000000000000000000000402' });
    expect(cfg.confirmAboveUsd).toBeLessThanOrEqual(cfg.perTxCapUsd);
    expect(() => assertConfirmCapLive(cfg)).not.toThrow();
    expect(() => assertConfirmCapLive({ ...cfg, confirmAboveUsd: 1, perTxCapUsd: 0.5 })).toThrow(/Plan Mode/);
  });

  it('mcp-config.example.json registers product server clearing', () => {
    const raw = readFileSync(join(process.cwd(), 'mcp-config.example.json'), 'utf8');
    const json = JSON.parse(raw) as { mcpServers: Record<string, unknown> };
    expect(Object.keys(json.mcpServers)).toEqual(['clearing']);
    expect(JSON.stringify(json)).not.toContain('xray-clearing');
  });

  it('SKILL.md is user-invocable clearing', () => {
    const skill = readFileSync(join(process.cwd(), 'SKILL.md'), 'utf8');
    expect(skill).toMatch(/^---\nname: clearing\n/m);
    expect(skill).toContain('user-invocable: true');
    expect(skill).toContain('Never request a private key');
  });

  it('tool definitions cover the spec surface', () => {
    expect(TOOL_DEFINITIONS.map((t) => t.name)).toEqual(TOOL_NAMES);
  });
});
