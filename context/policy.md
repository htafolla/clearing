# Clearing policy

Fail closed. Caps here are a second fuse. The rail is authoritative.

## Spend

- Chain: Base `8453` only. USDC `0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913`.
- Defaults: `perTxCapUsd=2.00`, `sessionCapUsd=5`, `dailyCapUsd=5`, `confirmAboveUsd=1.00` (confirm must be ≤ per-tx so Plan Mode can fire).
- Mutating tools default `dry_run=true`.
- Quote > per-tx cap → error, no HTTP request.
- Quote ≥ confirm threshold → `needs_approval`. Do not sign.
- Headless / no TTY at or above threshold → `needs_approval` and stop.
- `--always-approve` does not apply to pay tools. Ignore it.

## Keys

- Clearing does not hold keys.
- Private keys never enter model context.
- Signatures come from the rail (`q402` | `circle` | `coinbase` | `x402_fetch`).
- Missing rail → fail closed.

## Origins

- `api.clearing.dev` is always allowlisted.
- Other origins must be allowlisted or currently discover-live.
- Empty discover is expected on day 1. Unknown origin → reject.

## Idempotency

- Ledger key is `paymentId`.
- `paymentId` maps 1:1 to signed payload bytes. Never re-sign for the same id.
- State: `quoted` → `submitted` → `settled`. `replayed` does not increment caps.

## Extract

- One price. MCP `clearing_extract` is a wrapper around the HTTP 402, not a second SKU.
- Cache is worker cost control, not a buyer discount. Charge on cache hit.
- robots / no-ai / paid-origin: no stolen body.
- Do not charge when the policy block is known before settlement.

## Pin / listed

- Pin is $0.01 USDC on Base. A successful settle lists an agent on `GET /v1/listed` and `GET /v1/online` only if the card is Groover certified (DID / GRVR), Dynamo solar (PASS or governance citation), and has a live HTTPS MCP or hangar store (tools / 402 / health).
- Online = last health/live probe ok within N minutes. N = `probeIntervalMs` (default 15 minutes). Stale rows are re-probed on GET; failed or missing Groover/solar fail closed.
- Listed/online row: `{ agentId, pinnedAt, paymentId, tx?, mcpUrl?, storeUrl?, liveAt?, groover?, solar?, healthAt?, live: true }`. Identity-only cards are not listed. Pin alone is not enough.
- No second directory fee. Unpaid pin is still 402.
- This is a pin + certified + live-shop index, not a job board.
- Shop catalog (`GET /v1/catalog`, protocol `clearing-catalog/0`) is the listed board, not hardcoded mill routes.

## Discover

- List only: card + endpoint + probe + recoverable quote + 7-day USDC settlement.
- Never list a registration-only ERC-8004 id.
- Do not scrape the 500k registry on the hot path.

## Blip hangar

- Skill `blip` quotes x402 **before** work. Failed gen → no charge.
- Price is the LOCKED quadratic escalator. Do not invent ¢. Do not use the rejected flat `5 + floor(n/100)`.
- Pay is ZigZag-**shaped** EIP-3009 (`signer:zigzag`). Not a marketplace. Hosted `/sign` is not the shop path.
- Ownership is the Base Blips NFT to the payer wallet. Soft-DB-only owned is a defect.
- No Dist. No market v0.

## Not this product

Wallet, faucet, job board, Mandate.sol, Escrow.sol, multi-chain, eighth `xray-*` MCP, ZigZag marketplace.
