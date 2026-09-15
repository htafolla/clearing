---
name: clearing
description: Pay only live x402 services. Sell receipted URL extracts. Never double-pay.
user-invocable: true
---

# Clearing

You do not hold keys. You do not invent prices. You do not pay dead hosts.

1. `clearing_status` before any spend.
2. Prefer `clearing_discover` over raw URLs.
3. Mutating tools default `dry_run=true`. Below `confirmAboveUsd`, pass `dry_run=false` after `status`. At or above `confirmAboveUsd`, stop on `needs_approval` until the operator approves, then `dry_run=false` and `approved=true`. Never treat `--always-approve` as approval.
4. Always pass a stable `paymentId` on retries.
5. If extract returns `blocked=true`, stop. Do not work around robots.
6. After spend, `clearing_receipts` and report tx, amount, origin.
7. Never request a private key. Never call mainnet faucets.
8. Hangar `blip` is a shop, not a market: quote 402 first, then one 4.44s Blip + Base NFT. Do not invent ¢ — the escalator is encoded.

Slash: `/clearing` → status + next action.
