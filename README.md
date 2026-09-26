# Clearing

Grok may spend USDC only on endpoints that are alive, and never twice for the same payment.

v1 sells metered artifacts: a receipted web extract, and hangar skill `blip` (4.44s factory plant + Base Blips NFT). It is a Grok skill + product MCP. It is not a wallet, faucet, or job board.

- Spec: [TECH-SPEC.md](./TECH-SPEC.md)
- Skill: [SKILL.md](./SKILL.md)
- Agents: [public/agents.md](./public/agents.md)
- Policy: [context/policy.md](./context/policy.md)
- Constraints: [CONSTRAINTS.md](./CONSTRAINTS.md)

Public unpaid well-known:

- `GET /.well-known/x402` — JSON including `agentToolsVerify`. Default token is `public/.well-known/x402`; override with `CLEARING_AGENT_TOOLS_VERIFY` or `AGENT_TOOLS_VERIFY_DESCRIPTOR`.
- `GET /.well-known/agent-tools-verify.txt` — rippel.ai ATC file claim (`atc_ahATpKU6I8yhcD0aIdaKZp3ONf0bjyj9`). Do not change that file. Railway hostname uses `AGENT_TOOLS_VERIFY_TOKEN_RAILWAY` instead.
- `GET|POST /v1/blip` — hangar skill `blip`. x402 quote (ZigZag-shaped EIP-3009, `signer:zigzag`, not a marketplace) then factory plant `blip` + Blips ERC-721 to the payer. Escalator LOCKED: `price¢ = max(5, round(5 + 550 * (mintIndex/555)**2))`. See [docs/BLIPS.md](./docs/BLIPS.md).

Local:

```bash
CLEARING_ALLOW_FAKE=1 npm run extract   # :8787  402 extract
CLEARING_ALLOW_FAKE=1 npm run mcp       # stdio MCP named clearing
npm test
```

HTTP MCP hostnames are not live. Do not `railway link` usmail-ai. Wear is `npm i 0xray` (garment). Do not mill-plant. Product MCP is `clearing`, never `xray-clearing`.

## Selling without zigzag (CDP facilitator)

An outside seller can settle buyer payments with Coinbase’s public x402 facilitator. No `CLEARING_SIGNER`, `CLEARING_RAIL_TOKEN`, or `CLEARING_ZIGZAG_URL`.

On a hosted boot (`RAILWAY_ENVIRONMENT` set, or `NODE_ENV=production`):

```bash
CLEARING_FACILITATOR=cdp
CDP_API_KEY_ID=          # seller’s own CDP secret API key id
CDP_API_KEY_SECRET=      # seller’s own CDP secret API key (Ed25519 or EC PEM)
CLEARING_PAY_TO=         # seller’s Base address; USDC lands here
```

Settlement is Base (`eip155:8453`) USDC `0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913`. Buyers sign EIP-3009 with domain name `USD Coin` and version `2`. The paid request URL must be public `https`. Clearing’s own filter in `mcp/src/facilitator.ts` skips `*.railway.app` hostnames and `/v1/ping`, so attach a custom domain. Each seller brings their own CDP account and keys. This repo does not hold them.
