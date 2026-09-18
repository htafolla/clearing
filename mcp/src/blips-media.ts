/**
 * Durable Blip tapes. Plant /artifacts is scratch.
 * Hangar copies the mp4 onto dataDir (Railway volume) and serves /v1/blip/media/:id.mp4
 */
import { spawnSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { FetchFn } from './types.js';
import { collectionTag } from './blips-store.js';

const MIN_BYTES = 256;

export function blipsMediaDir(dataDir: string, nft?: string): string {
  return join(dataDir, `blips-media-${collectionTag(nft)}`);
}

export function blipsMediaPath(dataDir: string, mintIndex: number, nft?: string): string {
  return join(blipsMediaDir(dataDir, nft), `${mintIndex}.mp4`);
}

export function hangarMediaUrl(base: string, mintIndex: number): string {
  return `${base.replace(/\/$/, '')}/v1/blip/media/${mintIndex}.mp4`;
}

export function isHangarTapeUrl(url: string | undefined): boolean {
  if (!url) return false;
  return /\/v1\/blip\/media\/\d+\.mp4$/i.test(url.split('?')[0] || '');
}

export function hangarPosterUrl(base: string, mintIndex: number): string {
  return `${base.replace(/\/$/, '')}/v1/blip/poster/${mintIndex}.jpg`;
}

export function blipsPosterPath(dataDir: string, mintIndex: number, nft?: string): string {
  return join(blipsMediaDir(dataDir, nft), `${mintIndex}.jpg`);
}

export function readBlipPoster(dataDir: string, mintIndex: number, nft?: string): Buffer | undefined {
  const path = blipsPosterPath(dataDir, mintIndex, nft);
  if (!existsSync(path)) return undefined;
  return readFileSync(path);
}

/** First real frame of the tape. SVG ident is only a fallback. */
export function ensureVideoPoster(dataDir: string, mintIndex: number, nft?: string): Buffer | undefined {
  const existing = readBlipPoster(dataDir, mintIndex, nft);
  if (existing && existing.byteLength > MIN_BYTES) return existing;
  const mp4 = blipsMediaPath(dataDir, mintIndex, nft);
  if (!existsSync(mp4)) return undefined;
  const jpg = blipsPosterPath(dataDir, mintIndex, nft);
  mkdirSync(blipsMediaDir(dataDir, nft), { recursive: true });
  const r = spawnSync(
    'ffmpeg',
    ['-y', '-ss', '0.35', '-i', mp4, '-frames:v', '1', '-q:v', '4', jpg],
    { encoding: 'utf8', timeout: 20_000 },
  );
  if (r.status !== 0 || !existsSync(jpg)) return undefined;
  return readFileSync(jpg);
}

export function parseMediaMintIndex(pathname: string): number | undefined {
  const m = /\/v1\/blip\/media\/(\d+)(?:\.mp4)?$/i.exec(pathname);
  if (!m) return undefined;
  const n = Number.parseInt(m[1]!, 10);
  return Number.isInteger(n) && n >= 0 ? n : undefined;
}

export function parsePosterMintIndex(pathname: string): number | undefined {
  const m = /\/v1\/blip\/poster\/(\d+)(?:\.(?:svg|jpg|jpeg|png))?$/i.exec(pathname);
  if (!m) return undefined;
  const n = Number.parseInt(m[1]!, 10);
  return Number.isInteger(n) && n >= 0 ? n : undefined;
}

/** Marketplace card. OpenSea needs `image`; `animation_url` alone shows a blank. */
export function posterSvg(tokenId: number, picture = 'still'): string {
  const label = picture.replace('motion:', '');
  const id = String(tokenId);
  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1200 630">
  <rect width="1200" height="630" fill="#08090B"/>
  <rect x="24" y="24" width="1152" height="582" fill="none" stroke="#F5C518" stroke-width="3"/>
  <path d="M80 360 L180 360 L260 140 L360 500 L460 80 L560 360 L680 200 L800 420 L920 120 L1120 360" fill="none" stroke="#3DE0E8" stroke-width="6" stroke-linejoin="round"/>
  <text x="80" y="88" fill="#3DE0E8" font-family="ui-monospace, monospace" font-size="28">BLIPS</text>
  <text x="80" y="560" fill="#F5F7FA" font-family="ui-sans-serif, sans-serif" font-size="52" font-weight="700">#${id}</text>
  <text x="80" y="600" fill="#8B939C" font-family="ui-monospace, monospace" font-size="22">${label} · 4.44s</text>
</svg>
`;
}

export function copyBlipMedia(dataDir: string, fromIndex: number, toIndex: number, nft?: string): boolean {
  const src = blipsMediaPath(dataDir, fromIndex, nft);
  if (!existsSync(src)) return false;
  mkdirSync(blipsMediaDir(dataDir, nft), { recursive: true });
  copyFileSync(src, blipsMediaPath(dataDir, toIndex, nft));
  return true;
}

export function readBlipMedia(dataDir: string, mintIndex: number, nft?: string): Buffer | undefined {
  const path = blipsMediaPath(dataDir, mintIndex, nft);
  if (!existsSync(path)) return undefined;
  return readFileSync(path);
}

export async function archivePlantVideo(opts: {
  videoUrl: string | undefined;
  dataDir: string;
  mintIndex: number;
  publicBase: string;
  fetchFn: FetchFn;
  nft?: string;
}): Promise<string | undefined> {
  if (!opts.videoUrl) return undefined;
  try {
    const res = await opts.fetchFn(opts.videoUrl, { signal: AbortSignal.timeout(60_000) });
    if (!res.ok) return opts.videoUrl;
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.byteLength < MIN_BYTES) return opts.videoUrl;
    mkdirSync(blipsMediaDir(opts.dataDir, opts.nft), { recursive: true });
    writeFileSync(blipsMediaPath(opts.dataDir, opts.mintIndex, opts.nft), buf);
    ensureVideoPoster(opts.dataDir, opts.mintIndex, opts.nft);
    return hangarMediaUrl(opts.publicBase, opts.mintIndex);
  } catch {
    return opts.videoUrl;
  }
}

export function mediaFileResponse(buf: Buffer, rangeHeader: string | null): Response {
  const total = buf.byteLength;
  const cors = {
    'Access-Control-Allow-Origin': '*',
    'Content-Type': 'video/mp4',
    'Accept-Ranges': 'bytes',
    'Cache-Control': 'public, max-age=31536000, immutable',
  };
  if (!rangeHeader || !rangeHeader.startsWith('bytes=')) {
    return new Response(new Uint8Array(buf), {
      status: 200,
      headers: { ...cors, 'Content-Length': String(total) },
    });
  }
  const spec = rangeHeader.slice('bytes='.length).split('-');
  const start = Number.parseInt(spec[0] || '0', 10);
  const end = spec[1] ? Number.parseInt(spec[1], 10) : total - 1;
  if (!Number.isInteger(start) || !Number.isInteger(end) || start < 0 || end >= total || start > end) {
    return new Response(null, { status: 416, headers: { ...cors, 'Content-Range': `bytes */${total}` } });
  }
  const slice = buf.subarray(start, end + 1);
  return new Response(new Uint8Array(slice), {
    status: 206,
    headers: {
      ...cors,
      'Content-Length': String(slice.byteLength),
      'Content-Range': `bytes ${start}-${end}/${total}`,
    },
  });
}
