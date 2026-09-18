/**
 * ERC-8004 register(string) mill. Hangar pays gas; payer owns the token.
 */
import { IDENTITY_REGISTRY, type HexAddress } from './types.js';
import { normalizeAddress } from './bytes.js';

export type CardRegisterResult = {
  agentId: number;
  agentURI: string;
  owner: HexAddress;
  txHash: HexAddress;
};

export interface CardRegistrar {
  ready(): boolean;
  register(agentURI: string, to: HexAddress): Promise<CardRegisterResult>;
}

export class MemoryCardRegistrar implements CardRegistrar {
  private nextId = 1;
  constructor(private readonly operator: HexAddress = '0x0000000000000000000000000000000008004') {}

  ready(): boolean {
    return true;
  }

  async register(agentURI: string, to: HexAddress): Promise<CardRegisterResult> {
    const agentId = this.nextId;
    this.nextId += 1;
    const owner = normalizeAddress(to);
    const txHash = (`0x${agentId.toString(16).padStart(8, '0')}${'ab'.repeat(28)}`) as HexAddress;
    void this.operator;
    return { agentId, agentURI, owner, txHash };
  }
}

export function createCardRegistrar(opts: {
  allowFake: boolean;
  privateKey?: string;
  rpcUrl?: string;
}): CardRegistrar {
  if (opts.allowFake) return new MemoryCardRegistrar();
  const key = opts.privateKey?.trim();
  if (!key) return new OffCardRegistrar();
  return new RpcCardRegistrar(key, opts.rpcUrl);
}

class OffCardRegistrar implements CardRegistrar {
  ready(): boolean {
    return false;
  }

  async register(): Promise<CardRegisterResult> {
    throw new Error('card mill off — set CLEARING_8004_KEY');
  }
}

class RpcCardRegistrar implements CardRegistrar {
  constructor(
    private readonly privateKey: string,
    private readonly rpcUrl?: string,
  ) {}

  ready(): boolean {
    return true;
  }

  async register(agentURI: string, to: HexAddress): Promise<CardRegisterResult> {
    const { createPublicClient, createWalletClient, decodeEventLog, http } = await import('viem');
    const { privateKeyToAccount } = await import('viem/accounts');
    const { base } = await import('viem/chains');
    const hex = (this.privateKey.startsWith('0x') ? this.privateKey : `0x${this.privateKey}`) as HexAddress;
    if (!/^0x[0-9a-fA-F]{64}$/.test(hex)) throw new Error('CLEARING_8004_KEY not 32-byte hex');
    const account = privateKeyToAccount(hex);
    const transport = http(this.rpcUrl || process.env.CLEARING_RPC_URL || 'https://mainnet.base.org');
    const wallet = createWalletClient({ account, chain: base, transport });
    const publicClient = createPublicClient({ chain: base, transport });
    const abi = [
      {
        type: 'function',
        name: 'register',
        stateMutability: 'nonpayable',
        inputs: [{ name: 'agentURI', type: 'string' }],
        outputs: [{ name: 'agentId', type: 'uint256' }],
      },
      {
        type: 'function',
        name: 'transferFrom',
        stateMutability: 'nonpayable',
        inputs: [
          { name: 'from', type: 'address' },
          { name: 'to', type: 'address' },
          { name: 'tokenId', type: 'uint256' },
        ],
        outputs: [],
      },
      {
        type: 'event',
        name: 'Registered',
        inputs: [
          { name: 'agentId', type: 'uint256', indexed: true },
          { name: 'agentURI', type: 'string', indexed: false },
          { name: 'owner', type: 'address', indexed: true },
        ],
      },
    ] as const;
    const hash = await wallet.writeContract({
      address: IDENTITY_REGISTRY,
      abi,
      functionName: 'register',
      args: [agentURI],
      account,
      chain: base,
    });
    const receipt = await publicClient.waitForTransactionReceipt({ hash });
    if (receipt.status !== 'success') throw new Error('8004 register reverted');
    let agentId = 0;
    for (const log of receipt.logs) {
      try {
        const decoded = decodeEventLog({ abi, data: log.data, topics: log.topics });
        if (decoded.eventName === 'Registered') {
          const args = decoded.args as { agentId?: bigint };
          if (args.agentId !== undefined) agentId = Number(args.agentId);
        }
      } catch {
        /* skip */
      }
    }
    if (!agentId) throw new Error('Registered event missing agentId');
    const payer = normalizeAddress(to);
    if (payer.toLowerCase() !== account.address.toLowerCase()) {
      const xfer = await wallet.writeContract({
        address: IDENTITY_REGISTRY,
        abi,
        functionName: 'transferFrom',
        args: [account.address, payer, BigInt(agentId)],
        account,
        chain: base,
      });
      const xReceipt = await publicClient.waitForTransactionReceipt({ hash: xfer });
      if (xReceipt.status !== 'success') throw new Error('8004 transfer reverted');
      return { agentId, agentURI, owner: payer, txHash: xfer };
    }
    return { agentId, agentURI, owner: payer, txHash: hash };
  }
}
