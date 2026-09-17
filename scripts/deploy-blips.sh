#!/usr/bin/env bash
# Deploy Blips v2. Reads keys from env. Does not echo secrets.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"
: "${ETH_RPC_URL:?}"
: "${BLIPS_MINTER_PRIVATE_KEY:?}"
: "${BLIPS_MINTER:?}"
: "${BLIPS_ROYALTY_RECEIVER:?}"
BPS="${BLIPS_ROYALTY_BPS:-500}"
export PATH="${HOME}/.foundry/bin:${PATH}"
PK="$BLIPS_MINTER_PRIVATE_KEY"
if [[ "$PK" != 0x* ]]; then PK="0x$PK"; fi
forge create contracts/Blips.sol:Blips \
  --rpc-url "$ETH_RPC_URL" \
  --private-key "$PK" \
  --broadcast \
  --constructor-args "$BLIPS_MINTER" "$BLIPS_ROYALTY_RECEIVER" "$BPS" \
  --json | python3 -c 'import json,sys; d=json.load(sys.stdin); print(d.get("deployedTo") or d.get("address") or "")'
