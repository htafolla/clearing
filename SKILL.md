---
name: clearing
description: Pay live x402 shops from local OWS. Mint 4.44s Blips on the hosted hangar. Never double-pay.
user-invocable: true
---

# Clearing

You do not hold keys. Keys stay in local OWS (`~/.ows`). The hangar is hosted.

## Wear (once)

`clearing` MCP stdio: `tsx mcp/src/server.ts` with:

```
CLEARING_EXTRACT_BASE_URL=https://clearing.rippel.ai
CLEARING_SIGNER=zigzag
CLEARING_PAY_TO=0xc9cD4E19e8fFabFC479352680295ba12e454462D
ZIGZAG_WALLET=<ows wallet name with USDC on Base>
```

No ZigZag HTTP rail. No `:8789`. Loopback URLs are ignored; OWS signs in-process.

## Pay a shortie

1. `status` — note `owsWallet`, `hangar`, caps. If the wallet has no USDC on Base, stop.
2. `blip` `picture=motion:orb` `brief="..."` `dry_run=true` — read the ¢. Do not invent the price.
3. Same call with `dry_run=false`. Below `confirmAboveUsd` that is enough. At or above it, wait for the operator then `approved=true`.
4. Wait up to **3 minutes**. Retry with the **same paymentId**. Never re-sign.
5. `receipts` — report `tokenId`, `videoUrl`, `mintTx`. NFT lands on the OWS address.

`picture` is `still` or `motion:<orb|swirl|snap|waves|spark|kapow>`.

## Rules

- Prefer `discover` over raw URLs for extracts.
- `extract` / `blip` / `fetch_paid` default `dry_run=true`.
- Never treat `--always-approve` as approval.
- Never request a private key. Never call a faucet.
- If `blocked=true`, stop.

Slash: `/clearing` → `status` then mint or extract.
