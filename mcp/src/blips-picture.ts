/**
 * Hangar picture modes — v0 seed + kapow opt match factory plant `blip` (xray 4.0.15 / d466f1a91).
 * Unknown id FAIL. kapow is a design opt (two-tier stamp), not a growth stub.
 */
export const BLIP_V0_IDS = ['still', 'orb', 'swirl', 'snap', 'waves', 'spark'] as const;
export const BLIP_OPT_IDS = ['kapow'] as const;
export const BLIP_LIVE_IDS = [...BLIP_V0_IDS, ...BLIP_OPT_IDS] as const;

export type BlipPicture =
  | { ok: true; picture: 'still' | `motion:${string}`; motionId: string }
  | { ok: false; reason: string };

export function parseBlipPicture(raw: string): BlipPicture {
  const v = raw.trim().toLowerCase();
  if (!v) return { ok: false, reason: 'picture is required (still | motion:<id>)' };
  if (v === 'still') return { ok: true, picture: 'still', motionId: 'still' };
  const m = /^motion:([a-z0-9_-]+)$/.exec(v);
  if (!m) return { ok: false, reason: 'picture must be still or motion:<id>' };
  const id = m[1];
  if (!(BLIP_LIVE_IDS as readonly string[]).includes(id)) {
    return { ok: false, reason: `unknown motion id: ${id}` };
  }
  if (id === 'still') return { ok: true, picture: 'still', motionId: 'still' };
  return { ok: true, picture: `motion:${id}`, motionId: id };
}

export function isLiveMotionId(id: string): boolean {
  return (BLIP_LIVE_IDS as readonly string[]).includes(id);
}
