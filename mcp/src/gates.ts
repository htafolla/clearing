/**
 * Hangar list gates beyond live shop: Groover certified + Dynamo solar.
 * Fail closed. Card or registry proof only — no mint, no 8004scan clone.
 */
export type GrooverProof = string;
export type SolarProof = string;

const DID_RE = /^did:groover:[0-9a-f]{16,64}$/i;
const GRVR_RE = /^eip155:8453:0x[0-9a-f]{40}\/\d+$/i;
const CITATION_RE = /^0x[0-9a-f]{64}$/i;

export function grooverProof(card: unknown): GrooverProof | undefined {
  if (!card || typeof card !== 'object') return undefined;
  const rec = card as Record<string, unknown>;
  const groover = asRecord(rec.groover);

  const did = asString(groover?.did) ?? serviceEndpoint(rec, 'did');
  if (did && DID_RE.test(did)) return did;

  const grvr =
    asString(groover?.grvr) ??
    serviceEndpoint(rec, 'grvr') ??
    grvrFromParts(groover);
  if (grvr && GRVR_RE.test(grvr)) return grvr;
  return undefined;
}

export function solarProof(card: unknown): SolarProof | undefined {
  if (!card || typeof card !== 'object') return undefined;
  const rec = card as Record<string, unknown>;
  const groover = asRecord(rec.groover);
  const solar = asRecord(groover?.solar) ?? asRecord(rec.solar) ?? asRecord(rec.governance);

  const citation =
    asString(groover?.dynamoCitation) ??
    asString(solar?.citation) ??
    asString(solar?.dynamoCitation) ??
    asString(rec.dynamoCitation);
  const cited = citation && CITATION_RE.test(citation) ? citation.toLowerCase() : undefined;

  if (hasPass(solar) || hasPass(groover) || hasPass(rec.governance) || hasPass(rec.solar)) {
    return cited ?? 'PASS';
  }
  return cited;
}

export function hangarCertified(card: unknown): { groover: GrooverProof; solar: SolarProof } | undefined {
  const groover = grooverProof(card);
  const solar = solarProof(card);
  if (!groover || !solar) return undefined;
  return { groover, solar };
}

function hasPass(value: unknown): boolean {
  if (typeof value === 'string') return value.trim().toUpperCase() === 'PASS';
  if (!value || typeof value !== 'object') return false;
  const rec = value as Record<string, unknown>;
  if (rec.pass === true) return true;
  for (const key of ['verdict', 'recommendation', 'fullBox7DVerdict', 'hammerVerdict', 'solarVerdict']) {
    if (typeof rec[key] === 'string' && rec[key].trim().toUpperCase() === 'PASS') return true;
  }
  return false;
}

function serviceEndpoint(card: Record<string, unknown>, name: string): string | undefined {
  if (!Array.isArray(card.services)) return undefined;
  for (const svc of card.services) {
    if (!svc || typeof svc !== 'object') continue;
    const row = svc as { name?: unknown; endpoint?: unknown };
    if (typeof row.name !== 'string' || typeof row.endpoint !== 'string') continue;
    if (row.name.toLowerCase() === name) return row.endpoint.trim();
  }
  return undefined;
}

function grvrFromParts(groover: Record<string, unknown> | undefined): string | undefined {
  if (!groover) return undefined;
  const contract = asString(groover.grvrContract);
  const tokenId = groover.grvrTokenId;
  if (!contract || !/^0x[0-9a-f]{40}$/i.test(contract)) return undefined;
  const id = typeof tokenId === 'number' ? String(tokenId) : asString(tokenId);
  if (!id || !/^\d+$/.test(id)) return undefined;
  return `eip155:8453:${contract}/${id}`;
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function asString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}
