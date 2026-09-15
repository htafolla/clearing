import { describe, expect, it } from 'vitest';
import { HttpBlipsMinter } from '../mcp/src/blips-nft.js';
import { ClearingError } from '../mcp/src/errors.js';
import { PAYER_A } from './helpers.js';

const TX_HASH = `0x${'ab'.repeat(32)}`;
const ADDRESS = `0x${'cd'.repeat(20)}`;

function jsonFetch(body: unknown, status = 200): typeof fetch {
  return async () =>
    new Response(JSON.stringify(body), {
      status,
      headers: { 'content-type': 'application/json' },
    });
}

describe('HttpBlipsMinter.mint', () => {
  it('accepts mintTx as a 32-byte tx hash', async () => {
    const minter = new HttpBlipsMinter('https://minter.test/mint', jsonFetch({
      tokenId: 7,
      mintTx: TX_HASH,
      ownerWallet: PAYER_A,
    }));
    const minted = await minter.mint({ ownerWallet: PAYER_A, tokenURI: 'ipfs://blip', mintIndex: 7 });
    expect(minted.tokenId).toBe(7);
    expect(minted.mintTx).toBe(TX_HASH);
  });

  it('rejects a 20-byte address as mintTx', async () => {
    const minter = new HttpBlipsMinter('https://minter.test/mint', jsonFetch({
      tokenId: 7,
      mintTx: ADDRESS,
    }));
    await expect(
      minter.mint({ ownerWallet: PAYER_A, tokenURI: 'ipfs://blip', mintIndex: 7 }),
    ).rejects.toMatchObject({
      code: 'nft_mint',
      message: 'blips minter missing tokenId/mintTx',
    } satisfies Partial<ClearingError>);
  });
});
