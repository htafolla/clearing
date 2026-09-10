import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

describe('0xray wear vs product MCP', () => {
  it('depends on 0xray garment, not mill plant source', () => {
    const pkg = JSON.parse(readFileSync(join(process.cwd(), 'package.json'), 'utf8')) as {
      dependencies: Record<string, string>;
    };
    expect(pkg.dependencies['0xray']).toBeTruthy();
    expect(pkg.dependencies['@0xray/foundry']).toBeUndefined();
    expect(existsSync(join(process.cwd(), 'src/skills'))).toBe(false);
  });

  it('example product MCP is named clearing, not xray-clearing', () => {
    const json = JSON.parse(readFileSync(join(process.cwd(), 'mcp-config.example.json'), 'utf8')) as {
      mcpServers: Record<string, unknown>;
    };
    expect(Object.keys(json.mcpServers)).toEqual(['clearing']);
  });

  it('worn .mcp.json keeps seven xray-* servers and adds product clearing', () => {
    const path = join(process.cwd(), '.mcp.json');
    if (!existsSync(path)) return;
    const json = JSON.parse(readFileSync(path, 'utf8')) as { mcpServers: Record<string, unknown> };
    const keys = Object.keys(json.mcpServers);
    const xray = keys.filter((k) => k.startsWith('xray-'));
    expect(xray).toHaveLength(7);
    expect(keys).toContain('clearing');
    expect(keys).not.toContain('xray-clearing');
    expect(xray.every((k) => k !== 'xray-clearing')).toBe(true);
  });
});
