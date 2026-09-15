/**
 * Blips ERC-721 minter — NEW collection (not GRVR / ERC-8004).
 * Pay settle gates mint to the payer wallet. Keys stay on the minter rail.
 */
import { createHash } from 'node:crypto';
import { isHexBytes32, normalizeAddress } from './bytes.js';
import { ClearingError } from './errors.js';
import type { HexAddress } from './types.js';

export type BlipMintInput = {
  ownerWallet: HexAddress;
  tokenURI: string;
  mintIndex: number;
};

export type BlipMintResult = {
  tokenId: number;
  mintTx: HexAddress;
  ownerWallet: HexAddress;
};

export type OwnedBlip = {
  tokenId: number;
  ownerWallet: HexAddress;
  mintTx: HexAddress;
  tokenURI: string;
  mintIndex: number;
};

export interface BlipsMinter {
  mint(input: BlipMintInput): Promise<BlipMintResult>;
  tokensOf(owner: HexAddress): Promise<OwnedBlip[]>;
  get(tokenId: number): Promise<OwnedBlip | undefined>;
  totalSupply(): Promise<number>;
}

export class MemoryBlipsMinter implements BlipsMinter {
  private readonly tokens: OwnedBlip[] = [];

  async mint(input: BlipMintInput): Promise<BlipMintResult> {
    const ownerWallet = normalizeAddress(input.ownerWallet);
    const tokenId = input.mintIndex;
    const mintTx = fakeMintTx(ownerWallet, tokenId, input.tokenURI);
    const row: OwnedBlip = {
      tokenId,
      ownerWallet,
      mintTx,
      tokenURI: input.tokenURI,
      mintIndex: input.mintIndex,
    };
    this.tokens.push(row);
    return { tokenId, mintTx, ownerWallet };
  }

  async tokensOf(owner: HexAddress): Promise<OwnedBlip[]> {
    const want = normalizeAddress(owner);
    return this.tokens.filter((t) => t.ownerWallet === want);
  }

  async get(tokenId: number): Promise<OwnedBlip | undefined> {
    return this.tokens.find((t) => t.tokenId === tokenId);
  }

  async totalSupply(): Promise<number> {
    return this.tokens.length;
  }
}

export class HttpBlipsMinter implements BlipsMinter {
  constructor(
    private readonly url: string,
    private readonly fetchFn: typeof fetch,
  ) {}

  async mint(input: BlipMintInput): Promise<BlipMintResult> {
    const res = await this.fetchFn(this.url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(input),
    });
    if (!res.ok) {
      const text = await res.text();
      throw new ClearingError('nft_mint', `blips minter ${res.status}: ${text.slice(0, 200)}`, 502);
    }
    const json = (await res.json()) as { tokenId?: number; mintTx?: string; ownerWallet?: string };
    if (typeof json.tokenId !== 'number' || !json.mintTx || !isHexBytes32(json.mintTx)) {
      throw new ClearingError('nft_mint', 'blips minter missing tokenId/mintTx', 502);
    }
    return {
      tokenId: json.tokenId,
      mintTx: json.mintTx,
      ownerWallet: normalizeAddress(json.ownerWallet ?? input.ownerWallet),
    };
  }

  async tokensOf(owner: HexAddress): Promise<OwnedBlip[]> {
    const url = new URL(this.url);
    url.searchParams.set('owner', owner);
    const res = await this.fetchFn(url);
    if (!res.ok) return [];
    const json = (await res.json()) as { tokens?: OwnedBlip[] };
    return json.tokens ?? [];
  }

  async get(tokenId: number): Promise<OwnedBlip | undefined> {
    const url = new URL(this.url);
    url.searchParams.set('tokenId', String(tokenId));
    const res = await this.fetchFn(url);
    if (!res.ok) return undefined;
    const json = (await res.json()) as OwnedBlip;
    return json.tokenId === tokenId ? json : undefined;
  }

  async totalSupply(): Promise<number> {
    const url = new URL(this.url);
    url.searchParams.set('supply', '1');
    const res = await this.fetchFn(url);
    if (!res.ok) return 0;
    const json = (await res.json()) as { totalSupply?: number };
    return Number(json.totalSupply ?? 0);
  }
}

export class MissingBlipsMinter implements BlipsMinter {
  async mint(): Promise<BlipMintResult> {
    throw new ClearingError(
      'nft_missing',
      'BLIPS_MINT_URL required to mint the Base Blips ERC-721 (keys stay on the minter rail)',
      503,
    );
  }
  async tokensOf(): Promise<OwnedBlip[]> {
    return [];
  }
  async get(): Promise<OwnedBlip | undefined> {
    return undefined;
  }
  async totalSupply(): Promise<number> {
    return 0;
  }
}

export function createBlipsMinter(opts: { fetchFn?: typeof fetch; allowFake?: boolean } = {}): BlipsMinter {
  const url = process.env.BLIPS_MINT_URL?.trim();
  if (url) return new HttpBlipsMinter(url, opts.fetchFn ?? fetch);
  if (opts.allowFake) return new MemoryBlipsMinter();
  return new MissingBlipsMinter();
}

function fakeMintTx(owner: string, tokenId: number, tokenURI: string): HexAddress {
  const hex = createHash('sha256').update(`${owner}:${tokenId}:${tokenURI}`).digest('hex');
  return `0x${hex}` as HexAddress;
}
