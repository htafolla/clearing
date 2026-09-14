# Clearing

Grok may spend USDC only on endpoints that are alive, and never twice for the same payment.

v1 sells one metered artifact: a receipted web extract. It is a Grok skill + product MCP. It is not a wallet, chain, token, faucet, or job board.

- Spec: [TECH-SPEC.md](./TECH-SPEC.md)
- Skill: [SKILL.md](./SKILL.md)
- Agents: [public/agents.md](./public/agents.md)
- Policy: [context/policy.md](./context/policy.md)
- Constraints: [CONSTRAINTS.md](./CONSTRAINTS.md)

Public unpaid well-known:

- `GET /.well-known/x402` — JSON including `agentToolsVerify`. Default token is `public/.well-known/x402`; override with `CLEARING_AGENT_TOOLS_VERIFY` or `AGENT_TOOLS_VERIFY_DESCRIPTOR`.
- `GET /.well-known/agent-tools-verify.txt` — rippel.ai ATC file claim (`atc_ahATpKU6I8yhcD0aIdaKZp3ONf0bjyj9`). Do not change that file. Railway hostname uses `AGENT_TOOLS_VERIFY_TOKEN_RAILWAY` instead.

Local:

```bash
CLEARING_ALLOW_FAKE=1 npm run extract   # :8787  402 extract
CLEARING_ALLOW_FAKE=1 npm run mcp       # stdio MCP named clearing
npm test
```

HTTP MCP hostnames are not live. Do not `railway link` usmail-ai. Wear is `npm i 0xray` (garment). Do not mill-plant. Product MCP is `clearing`, never `xray-clearing`.
