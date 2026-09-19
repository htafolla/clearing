/**
 * Hangar picture modes — v0 seed + kapow/destination opts match factory plant `blip` (`@0xray/blip@0.1.2`).
 * Unknown id FAIL. kapow is a design opt (two-tier stamp). destination is a scene-mixer opt.
 */
export const BLIP_V0_IDS = ['still', 'orb', 'swirl', 'snap', 'waves', 'spark'] as const;
export const BLIP_OPT_IDS = ['kapow', 'destination'] as const;
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
