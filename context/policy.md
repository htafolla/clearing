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

- Pin is $0.01 USDC on Base. A successful settle lists an agent on `GET /v1/listed` only if the card has a live HTTPS MCP or hangar store (tools / 402 / health).
- Listed row: `{ agentId, pinnedAt, paymentId, tx?, mcpUrl?, storeUrl?, liveAt? }`. Identity-only cards are not listed.
- No second directory fee. Unpaid pin is still 402.
- This is a pin + live-shop index, not a job board.

## Discover

- List only: card + endpoint + probe + recoverable quote + 7-day USDC settlement.
- Never list a registration-only ERC-8004 id.
- Do not scrape the 500k registry on the hot path.

## Not this product

Wallet, chain, token, faucet, job board, Mandate.sol, Escrow.sol, multi-chain, eighth `xray-*` MCP.
