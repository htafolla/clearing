# Clearing

MCP: stdio product server `clearing` (never `xray-clearing`)
Extract: GET /v1/extract?url={url}&js=0|1
Chain: Base 8453
Asset: USDC 0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913
Price: 0.02 USDC; 0.05 USDC if js=1
Caps we honor as buyer: perTx 2.00, confirmAbove 1.00, session 5, daily 5
Retry: same paymentId; do not re-sign
Probe:

```
curl -i "http://127.0.0.1:8787/v1/extract?url=https://example.com"
```

Unpaid → 402. Paid → 200 JSON with markdown, textHash.
blocked=true → no body, no charge.

pin: GET /v1/pin?agentId={id} — $0.01 USDC. Pay pin + Groover + solar + live MCP/hangar store + online → listed.
blip: GET|POST /v1/blip?picture=still|motion:<id>&brief=... — hangar skill. 402 quote (ZigZag-shaped EIP-3009, not marketplace) then factory plant `blip` (xray 4.0.15, kapow opt live) + Base Blips ERC-721 to the payer. Escalator LOCKED: price¢ = max(5, round(5 + 550 * (mintIndex/555)**2)). mintIndex = settled paid count / collection totalSupply. No market v0. No Dist.
listed: GET /v1/listed (public, unpaid)
online: GET /v1/online (same gates; health ok within 15 min)

Public unpaid: /agents.md /llms.txt /.well-known/agent.json /.well-known/x402 /.well-known/agent-tools-verify.txt /v1/listed /v1/online /v1/blip/owned /v1/blip/metadata/:id /v1/blip/media/:id.mp4 /v1/blip/poster/:id.svg
