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

pin: GET /v1/pin?agentId={id} — $0.01 USDC. Pay pin + live MCP/hangar store → listed.
listed: GET /v1/listed (public, unpaid)

Public unpaid: /agents.md /llms.txt /.well-known/agent.json /.well-known/x402 /.well-known/agent-tools-verify.txt /v1/listed
