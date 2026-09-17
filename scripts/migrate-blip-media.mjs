#!/usr/bin/env node
/**
 * Remaster old Blips onto hangar /v1/blip/media (operator).
 * Old plant artifacts are gone. Brief/picture is best-effort from the mint era.
 */
const HANGAR = process.env.CLEARING_PUBLIC_URL || 'https://clearing.rippel.ai';
const TOKEN = process.env.CLEARING_OPERATOR_TOKEN || process.env.CLEARING_RAIL_TOKEN || '';
const DEFAULT = 'Cyan arc over a gold nameplate. Factory floor at shift change.';
const WAREHOUSE = 'warehouse floor';
const A = '0x00552afc18275c7723dad2EC95d77308738cE07e';
const B = '0x77E7A48609e9c8A77C7639172af9EEA0e5E80DF7';

/** tokenId -> { picture, brief, owner, aliasOf? } */
const MAP = {
  0: { picture: 'still', brief: WAREHOUSE, owner: A },
  1: { picture: 'still', brief: WAREHOUSE, owner: A, aliasOf: 0 },
  2: { picture: 'still', brief: WAREHOUSE, owner: A },
  3: { picture: 'still', brief: WAREHOUSE, owner: A },
  4: { picture: 'still', brief: WAREHOUSE, owner: A },
  5: { picture: 'motion:orb', brief: DEFAULT, owner: B },
  6: { picture: 'motion:orb', brief: DEFAULT, owner: B },
  7: { picture: 'motion:orb', brief: DEFAULT, owner: B },
  8: { picture: 'motion:orb', brief: DEFAULT, owner: B },
  9: { picture: 'motion:kapow', brief: DEFAULT, owner: B },
  10: { picture: 'motion:kapow', brief: DEFAULT, owner: B, aliasOf: 9 },
  11: { picture: 'motion:kapow', brief: DEFAULT, owner: B },
  12: { picture: 'motion:kapow', brief: DEFAULT, owner: B },
  13: { picture: 'motion:kapow', brief: DEFAULT, owner: B },
  14: { picture: 'motion:kapow', brief: DEFAULT, owner: B },
  15: { picture: 'motion:kapow', brief: DEFAULT, owner: B },
  16: { picture: 'motion:kapow', brief: DEFAULT, owner: B },
  17: { picture: 'motion:kapow', brief: DEFAULT, owner: B },
  18: { picture: 'motion:kapow', brief: DEFAULT, owner: B, aliasOf: 17 },
  19: { picture: 'motion:kapow', brief: DEFAULT, owner: B },
  20: { picture: 'motion:kapow', brief: DEFAULT, owner: B, aliasOf: 19 },
  21: { picture: 'motion:kapow', brief: DEFAULT, owner: B },
  22: { picture: 'motion:kapow', brief: DEFAULT, owner: B, aliasOf: 21 },
};

async function migrateOne(id, row) {
  const res = await fetch(`${HANGAR.replace(/\/$/, '')}/v1/blip/migrate`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${TOKEN}`,
    },
    body: JSON.stringify({
      tokenId: Number(id),
      picture: row.picture,
      brief: row.brief,
      ownerWallet: row.owner,
      aliasOf: row.aliasOf,
    }),
  });
  const text = await res.text();
  let body;
  try {
    body = JSON.parse(text);
  } catch {
    body = { raw: text.slice(0, 200) };
  }
  process.stdout.write(`${id} ${res.status} ${body.videoUrl || body.error || body.raw || 'ok'}\n`);
  if (!res.ok) throw new Error(`migrate ${id} ${res.status}`);
}

async function main() {
  if (!TOKEN) {
    process.stderr.write('CLEARING_OPERATOR_TOKEN or CLEARING_RAIL_TOKEN required\n');
    process.exit(1);
  }
  const ids = Object.keys(MAP)
    .map(Number)
    .sort((a, b) => a - b);
  const first = ids.filter((id) => MAP[id].aliasOf == null);
  const aliases = ids.filter((id) => MAP[id].aliasOf != null);
  for (const id of first) {
    await migrateOne(id, MAP[id]);
  }
  for (const id of aliases) {
    await migrateOne(id, MAP[id]);
  }
}

main().catch((err) => {
  process.stderr.write(`${err instanceof Error ? err.message : String(err)}\n`);
  process.exit(1);
});
