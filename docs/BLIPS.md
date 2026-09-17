# Hangar skill `blip` (Clearing)

A friend would hear: pay a few cents USDC on Base at the hangar, get one 4.44s Blip back — factory already exists; this ticket wires the shop.

Factory plant `blip` is a sibling to `mill` + `sound` (xray `4.0.15` / `d466f1a91`). This repo is the hangar shop. No Dist. No marketplace v0. `kapow` is a live design opt (`motion:kapow`).

## Route

| Piece | |
|-------|--|
| Skill id | `blip` |
| HTTP | `GET\|POST /v1/blip?picture=still\|motion:<id>&brief=...` |
| MCP | tool `blip` (Grok: `clearing__blip`) |
| Account | `GET /v1/blip/owned?wallet=0x…` — minter / chain ownership |
| Metadata | `GET /v1/blip/metadata/:tokenId` — tokenURI JSON |

## Plant invoke (how the factory is called)

Clearing does **not** vendor `@0xray/foundry` (see CONSTRAINTS). Hangar calls the sibling plant:

1. **Preferred:** `POST $BLIPS_FOUNDRY_URL` JSON `{ brief, picture, style? }` — foundry-as-service.
2. **CLI:** `BLIPS_FOUNDRY_CLI=1` → `npx @0xray/foundry blip render --brief TEXT --mode still|motion:<id>` (xray `4.0.15` / `d466f1a91`).
3. **Local/fake:** `CLEARING_ALLOW_FAKE=1` uses `FakeBlipPlant` (tests / kit). Not a live encode.

Not `npx @0xray/foundry mint`. Not a mill bolt-on.

## Pay honesty

- Quote **before** work. Failed gen → **no charge**.
- Base USDC. x402 v1 `X-PAYMENT` / v2 `PAYMENT-SIGNATURE`.
- ZigZag-**shaped** EIP-3009 (`signer:zigzag` on the 402 extra). Not a ZigZag marketplace listing. Hosted ZigZag `/sign` is a **buyer rail**, not the shop live path.

## Escalator LOCKED (Blaze)

SSOT: `hangar-magnet/ops/blips/PRICE-ESCALATOR.md`

```
price¢ = max(5, round(5 + 550 * (mintIndex/555)**2))
```

Quadratic ease-in. mintIndex 0 → **5¢**. mintIndex 555 → **555¢** ($5.55).  
**Not** the rejected flat `5 + floor(mintIndex/100)`. No HOLD / stub flag.

### mintIndex source

**`mintIndex` = settled paid Blip count** (0-based index of the next mint).

When a Blips ERC-721 is configured, hangar also reads minter `totalSupply()` and on-chain `totalSupply()` (`BLIPS_NFT`) and uses `max(settledPaid, minterSupply, chainSupply)` so the escalator cannot lag the collection.

`tokenId` of a mint equals that mint’s `mintIndex`. After N paid mints, `totalSupply == N` and the next quote is at `mintIndex = N`.

## NFT

New **Blips** collection on Base (`contracts/Blips.sol`) — not GRVR / ERC-8004.  
Pay settle **gates** `mint(to, tokenURI)` to the payer wallet (`eip3009.from`).  
`tokenURI` → 4.44s media + receipt fields. Soft-DB-only ownership is a defect.
Plant `/artifacts` is scratch. Hangar copies the mp4 onto `CLEARING_DATA_DIR/blips-media` and serves `GET /v1/blip/media/:id.mp4` (public, unpaid). Restart must not kill the tape.

Minter keys stay on the rail: set `BLIPS_MINT_URL` (and `BLIPS_NFT` after Blaze deploys). Fake stack uses `MemoryBlipsMinter` (still emits `tokenId` + `mintTx`; `/owned` reads the minter, not the receipt file alone).

## Out of scope

Mint front Railway (`blips.rippel.ai`) · Dist · market · Gleams · DNS
