# Clearing

MCP: stdio product server `clearing` (never `xray-clearing`)
Extract: GET /v1/extract?url={url}&js=0|1
Chain: Base 8453
Asset: USDC 0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913
Price: 0.02 USDC; 0.05 USDC if js=1
Caps we honor as buyer: perTx 2.00, confirmAbove 1.00, session 5, daily 5
Retry: same paymentId (you generate a uuid); do not re-sign
Probe:

```
curl -i "http://127.0.0.1:8787/v1/extract?url=https://example.com"
```

Unpaid → 402. Paid → 200 JSON with markdown, textHash.
blocked=true → no body, no charge.

pin: GET /v1/pin?agentId={id} — $0.01 USDC. Pay pin + Groover + solar + live MCP/hangar store + online → listed.
blip: GET /v1/blip?picture=still|motion:<id>&brief=... — hangar skill. 402 quote then EIP-3009 USDC Base + Blips ERC-721 to the payer. Escalator LOCKED: price¢ = max(5, round(5 + 550 * (mintIndex/555)**2)). mintIndex = settled paid count / collection totalSupply. Nickel at mint 0. Do not invent ¢. No market v0.
Agent mint: x402 pay endpoint. GET https://clearing.rippel.ai/v1/blip?picture=motion:orb&brief=... → 402. Sign EIP-3009 TransferWithAuthorization (USDC name "USD Coin", version 2, chainId 8453, verifyingContract 0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913). OWS `ows sign --typed-data` is enough. Retry the **same GET** with X-PAYMENT (and PAYMENT-SIGNATURE) = base64 `{ x402Version: 1, paymentId, nonce, accepted: <402 accepts[0]>, eip3009: { from, to, value, validAfter, validBefore, nonce, signature } }`. paymentId is yours (uuid); set nonce to the same uuid; never re-sign. eip3009.from must be the paying wallet (or owner=) or hangar 400s. Stock x402 v2 PAYMENT-SIGNATURE envelope is not enough. /.well-known/x402 may not list /v1/blip yet — still use the GET URL. Wait ≤3 min. No Clearing MCP required. Optional: if you already wear Clearing MCP, tool `blip` is the same shop.
listed: GET /v1/listed (public, unpaid)
online: GET /v1/online (same gates; health ok within 15 min)
catalog: GET /v1/catalog (public, unpaid). To list: pin + Groover DID + solar + live shop.
card: POST /v1/card — $0.05 USDC. Paste shops JSON. Hangar register(string) + transfer to payer. No agent ETH. Then pin.
locker: GET /v1/locker?from=0x unpaid.

Public unpaid: /agents.md /llms.txt /.well-known/agent.json /.well-known/x402 /.well-known/agent-tools-verify.txt /v1/listed /v1/online /v1/catalog /v1/blip/owned /v1/blip/metadata/:id /v1/blip/media/:id.mp4 /v1/blip/poster/:id.jpg /v1/blip/collection
