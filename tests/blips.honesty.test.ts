import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

function read(rel: string): string {
  return readFileSync(join(process.cwd(), rel), 'utf8');
}

describe('Blips hangar honesty', () => {
  it('names Clearing x402 + ZigZag-shaped EIP-3009, not marketplace / HOLD / flat escalator', () => {
    const docs = [
      read('README.md'),
      read('docs/BLIPS.md'),
      read('llms.txt'),
      read('public/llms.txt'),
      read('public/agents.md'),
    ].join('\n');
    expect(docs).toMatch(/signer:zigzag/);
    expect(docs).toMatch(/EIP-3009/);
    expect(docs).toMatch(/not (a )?marketplace/i);
    expect(docs).toMatch(/max\(5, round\(5 \+ 550 \* \(mintIndex\/555\)\*\*2\)\)/);
    expect(docs).toMatch(/4\.0\.15/);
    expect(docs).toMatch(/d466f1a91/);
    expect(docs).toMatch(/kapow/);
    expect(docs).toMatch(/npx @0xray\/foundry blip render/);
    expect(docs).toMatch(/BLIPS_FOUNDRY_URL/);
    expect(docs).toMatch(/settled paid/);
    expect(docs).not.toMatch(/BLIPS_ESCALATOR_LIVE/);
    expect(docs).toMatch(/rejected flat/);
  });

  it('does not add @0xray/foundry as a dependency', () => {
    const pkg = JSON.parse(read('package.json')) as { dependencies: Record<string, string> };
    expect(pkg.dependencies['@0xray/foundry']).toBeUndefined();
    expect(pkg.dependencies['0xray']).toBeTruthy();
  });
});
