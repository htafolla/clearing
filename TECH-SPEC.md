# Clearing — revised tech spec (v1)

Product: A Grok Build skill + MCP server that only pays live x402 services and sells one metered artifact: receipted web extract.

Not a product: wallet, chain, token, faucet, generic job marketplace, custom mandate contract.

One sentence: Grok may spend USDC only on endpoints that are alive, and never twice for the same payment.

## 1. Objective

Give a Grok Build session three tools that survive contact with the current market:

- **discover** — list services with a heartbeat and a recent real settlement
- **extract** — sell markdown+JSON for a URL, gated by x402 USDC on Base
- **fetch_paid** — buy a 402 resource through an existing signer, with idempotent `payment_id` and caps

Signer, gas, and spend ceilings come from an existing rail (Q402 Connect, Circle agent wallet, Coinbase Agentic Wallet, or local `@x402/fetch` + daemon). Clearing does not hold keys.

## 2. Non-goals (explicit)

- ERC-8004 as a growth metric
- Deploying Mandate.sol / Escrow.sol in v1
- Multi-chain routing
- Mainnet faucet claims
- Agent-to-agent job board
- Competing with Cloudflare/AWS on origin paywalls
- Auto-approve spend (`--always-approve` must not apply to pay tools)

Escrow can return in v2 only for `extract_url` jobs with a content-hash release check. Not before external extract revenue exists.

## 3. Users and trust boundary

| Actor | Holds keys? | Role |
| --- | --- | --- |
| Operator | Yes (or MPC at Circle/Q402/Coinbase) | Sets caps, funds USDC, approves ≥ threshold |
| Grok session | No | Calls MCP tools |
| Clearing MCP | Session token only | Policy check, probe, cache, receipts |
| Signer rail | Yes | Produces x402 payment payload |
| Extract worker | No chain key required | Fetches URL, hashes body, returns artifact |

Private keys never enter the model context. If a tool needs a signature, it asks the rail. If the rail is missing, the tool fails closed.

## 4. Repo layout (Grok Build native)

```
clearing/
  SKILL.md
  public/agents.md    # product card (not root AGENTS.md — macOS case-fold)
  public/llms.txt
  context/policy.md
  mcp/src/*.ts
  services/extract/worker.ts
  tests/
    idempotency.test.ts
    discover.filter.test.ts
    extract.402.test.ts
```

Install:

```bash
cp -R clearing ~/.grok/skills/clearing
grok mcp add --transport http clearing https://mcp.clearing.dev/mcp \
  --header "Authorization: Bearer ${CLEARING_SESSION_TOKEN}"
```

Local dev: stdio MCP from `mcp/`.

## 5. Runtime config

```ts
type ClearingConfig = {
  chainId: 8453
  usdc: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913"
  signer: "q402" | "circle" | "coinbase" | "x402_fetch"
  perTxCapUsd: number        // default 2.00 (must be >= confirmAboveUsd)
  sessionCapUsd: number      // default 5
  dailyCapUsd: number        // default 5, tracked by rail + local ledger
  confirmAboveUsd: number    // default 1.00 — Plan Mode / needs_approval threshold
  allowOrigins: string[]     // includes api.clearing.dev always
  extractPriceUsd: number    // default 0.02; 0.05 if js=true
  discoverMinSettlements7d: number // default 1
  probeTimeoutMs: number     // default 4000
}
```

Caps in Clearing are a second fuse. The rail’s policy is authoritative. Clearing must still refuse locally so a misconfigured rail cannot be driven by the model in a retry loop.

## 6. MCP tools

Namespace: `clearing__*`

Default `dry_run: true` on every mutating tool.

### `clearing_status`

No side effects.

Returns: signer backend, addresses (masked), remaining session/daily cap, last 10 receipts, extract endpoint, agent card URL.

### `clearing_discover`

Args: `{ query?: string, category?: "extract" | "api" | "mcp", limit?: number }`

Returns only rows that pass all gates in §8.

Never returns a registration-only ERC-8004 id.

### `clearing_extract`

Args: `{ url: string, js?: boolean, schema?: "markdown" | "json" }`

If caller is the local Grok agent buying our API: use `fetch_paid` against `https://api.clearing.dev/v1/extract`.

If caller is an external agent hitting the HTTP API: standard x402.

This tool is a convenience wrapper, not a second price.

### `clearing_fetch_paid`

Args: `{ url: string, maxUsd: number, paymentId?: string, dryRun?: boolean }`

Behavior:

1. If `maxUsd` > perTxCap → error, no request.
2. GET url.
3. If not 402, return body + `paid: false`.
4. If 402, parse `accepts[]` (seller challenge is x402 v2 + `extensions.bazaar`; buyer still sends ZigZag EIP-3009 on `X-PAYMENT` / `PAYMENT-SIGNATURE`).
5. Reject if origin not allowlisted and not in current discover set.
6. Reject if quoted price > `maxUsd` or remaining caps.
7. If price ≥ `confirmAboveUsd` and `dry_run` → return `needs_approval` intent. Grok Plan Mode must show it.
8. Create or reuse `paymentId` (UUIDv4).
9. Ask signer for payload bound to that id.
10. Retry request with payment header.
11. Persist receipt. If settle succeeded and HTTP dies, replay with same `paymentId` must not create a second debit.

### `clearing_receipts`

Args: `{ since?: string, paymentId?: string }`

Local `~/.clearing/receipts.jsonl` plus server copy.

No bootstrap tool in v1. Operator funds the rail wallet once. Status tells them if unfunded.

## 7. Extract HTTP API (the only revenue line)

```
GET /v1/extract?url={encodeURIComponent}&js=0|1
```

Unpaid → 402 x402 v2 (`x402Version: 2`, top-level `resource`, `accepts[].amount`, `extensions.bazaar`) with USDC Base quote (`extractPriceUsd` or 0.05 if `js=1`). Witness and pin use the same challenge shape. ZigZag still signs v1 EIP-3009 payloads.

Paid → 200:

```json
{
  "url": "https://example.com/post",
  "finalUrl": "https://example.com/post",
  "title": "...",
  "markdown": "...",
  "textHash": "sha256:...",
  "fetchedAt": "2026-08-30T20:00:00Z",
  "cacheTtlSec": 3600,
  "bytes": 12410,
  "blocked": false
}
```

Rules:

- Timeout 20s. Cache key = `sha256(finalUrl + content)`. TTL 1h.
- Max 200k chars.
- Policy checks run **before** settlement: robots.txt, no-ai / X-Robots-Tag, paid-origin 402, private SSRF. `{ blocked: true, reason }` with HTTP 200 and **no 402** — no charge. v1 does not refund; it refuses to quote. v1 does not buy upstream 402 (non-goal: competing with origin paywalls).
- v1 does not buy upstream 402. Paid-origin is `blocked: true` with no charge.
- No account. Wallet signature is identity.

`GET /agents.md`, `GET /llms.txt`, `GET /.well-known/agent.json`, `GET /.well-known/x402`, `GET /.well-known/agent-tools-verify.txt`, `GET /openapi.json`, `GET /v1/listed`, `GET /v1/online` are public and unpaid. `/.well-known/x402` is JSON with `agentToolsVerify` (default `public/.well-known/x402`, override `CLEARING_AGENT_TOOLS_VERIFY` / `AGENT_TOOLS_VERIFY_DESCRIPTOR`) plus `x402Version` and probe `resources` for x402scan. The verify.txt file is the rippel.ai ATC claim and must stay `atc_ahATpKU6I8yhcD0aIdaKZp3ONf0bjyj9`. Pay pin ($0.01) + Groover (DID/GRVR) + Dynamo solar (PASS or citation) + live HTTPS MCP or hangar store + online (health ok within 15 minutes, `probeIntervalMs`) → listed. Identity-only cards are not listed. Pin alone is not enough. No extra directory fee.

## 8. Discover filter (the actual moat)

A service is listable iff:

| Gate | Test |
| --- | --- |
| Card | `/.well-known/agent.json` or ERC-8004 metadata URI fetches and parses |
| Endpoint | At least one HTTP or MCP URL in the card |
| Probe | GET or 402-probe succeeds in `probeTimeoutMs` |
| Quote | 402 body has recoverable `payTo` + `asset` + `amount` |
| Settlement | ≥ `discoverMinSettlements7d` facilitator-visible USDC transfers to `payTo` in 7 days, excluding our own soak tests if tagged |
| Not self-deal only | Counterparty set size ≥ 2 distinct payer addresses preferred; flag `thinLiquidity: true` if 1 |

Rank: settlements/7d, then probe latency, then price.

Re-probe every 15 minutes. Drop on two consecutive failures.

Do not scrape the entire 500k registry on the hot path. Maintain a watchlist of origins that have ever settled, plus operator-submitted URLs.

## 9. Idempotency and receipts

```ts
type Receipt = {
  paymentId: string
  txHash?: `0x${string}`
  chainId: 8453
  token: "USDC"
  amountUsd: string
  payTo: `0x${string}`
  origin: string
  resource: string
  status: "quoted" | "submitted" | "settled" | "failed" | "replayed"
  createdAt: string
}
```

Ledger key: `paymentId`.

`paymentId` maps 1:1 to **signed payload bytes**. The rail must never re-sign for the same id (EIP-3009 nonce is the payload nonce, set equal to `paymentId` on the fake rail). Replay sends the same `X-PAYMENT` / `PAYMENT-SIGNATURE` header.

State machine: `quoted` → `submitted` → `settled`.

`replayed` is a settled row returned again; it must not increment caps.

Acceptance test (ship blocker): kill TCP after facilitator settle, call `fetch_paid` with same `paymentId`, assert one chain debit.

## 10. SKILL.md

See root `SKILL.md`.

## 11. agents.md (distribution)

See `public/agents.md`.

Machine-readable, no marketing:

- MCP: `https://mcp.clearing.dev/mcp`
- Extract: `https://api.clearing.dev/v1/extract`
- Chain: Base 8453, USDC
- Price: 0.02 / 0.05 js
- Caps we honor when we are the buyer
- “Retry with same paymentId”
- Probe command:

```bash
curl -i "https://api.clearing.dev/v1/extract?url=https://example.com"
```

Other agents install with:

> Read https://clearing.dev/agents.md and add the Clearing MCP.

## 12. Grok Build behavior

- Plan Mode required for `fetch_paid` when quote ≥ `confirmAboveUsd`.
- Spend tools stay on the parent session (one cap ledger). Discover may use a read-only subagent.
- Compatible with Claude Code via the same MCP (Grok already reads Claude MCP configs). Do not maintain two servers.
- Headless grok agent stdio: if no TTY and amount ≥ threshold, return `needs_approval` and stop.

## 13. Implementation order

| Day | Work |
| --- | --- |
| 1 | Extract worker + 402 on Base testnet/mainnet USDC. `agents.md`. One curl demo. |
| 2 | MCP status, extract, receipts. Wire signer via Q402 or `@x402/fetch`. No custom wallet. |
| 3 | `fetch_paid` + `payment_id` tests. Session/per-tx caps locally. |
| 4 | discover watchlist + 15-min probes + 7-day settlement filter. |
| 5 | `SKILL.md` in `~/.grok/skills/clearing`. First external paying wallet. |

No frontend. No contract deploy. No token.

## 14. Tests that define done

- Unpaid extract → 402; paid extract → 200 + `textHash`.
- `blocked: true` → no charge.
- Retry after drop → single debit.
- Quote $2 with cap $0.50 → no request.
- Origin neither allowlisted nor discover-live → reject.
- Discover omits endpoints that fail probe even if ERC-8004 exists.
- Skill loads in Grok (`grok inspect`) and tools are namespaced `clearing__*`.

## 15. Metrics

Count these:

- Unique external payer addresses / week
- Extract USDC / week (exclude self)
- Double-debit incidents (must stay 0)
- Discover precision: % of listed origins that succeed on next independent probe
- Time from `/clearing` to first successful paid extract

Do not count ERC-8004 mints, MCP installs, or testnet drips.

Kill criterion: 30 days, no external USDC to the extract `payTo`.

## 16. v2 backlog (not now)

- Hash-checked escrow for third-party extract workers
- Cross-rail receipt rollup (x402 + card/MPP)
- Policy language beyond caps (velocity, time windows) — only if the rail does not provide it
- Solana x402 path if Grok users actually show up there

v1 is a Grok skill that sells a receipted page and refuses ghosts. That is the whole spec.
