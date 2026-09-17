/**
 * Durable Blip tapes. Plant /artifacts is scratch.
 * Hangar copies the mp4 onto dataDir (Railway volume) and serves /v1/blip/media/:id.mp4
 */
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { FetchFn } from './types.js';

const MIN_BYTES = 256;

export function blipsMediaDir(dataDir: string): string {
  return join(dataDir, 'blips-media');
}

export function blipsMediaPath(dataDir: string, mintIndex: number): string {
  return join(blipsMediaDir(dataDir), `${mintIndex}.mp4`);
}

export function hangarMediaUrl(base: string, mintIndex: number): string {
  return `${base.replace(/\/$/, '')}/v1/blip/media/${mintIndex}.mp4`;
}

export function parseMediaMintIndex(pathname: string): number | undefined {
  const m = /\/v1\/blip\/media\/(\d+)(?:\.mp4)?$/i.exec(pathname);
  if (!m) return undefined;
  const n = Number.parseInt(m[1]!, 10);
  return Number.isInteger(n) && n >= 0 ? n : undefined;
}

export function copyBlipMedia(dataDir: string, fromIndex: number, toIndex: number): boolean {
  const src = blipsMediaPath(dataDir, fromIndex);
  if (!existsSync(src)) return false;
  mkdirSync(blipsMediaDir(dataDir), { recursive: true });
  copyFileSync(src, blipsMediaPath(dataDir, toIndex));
  return true;
}

export function readBlipMedia(dataDir: string, mintIndex: number): Buffer | undefined {
  const path = blipsMediaPath(dataDir, mintIndex);
  if (!existsSync(path)) return undefined;
  return readFileSync(path);
}

export async function archivePlantVideo(opts: {
  videoUrl: string | undefined;
  dataDir: string;
  mintIndex: number;
  publicBase: string;
  fetchFn: FetchFn;
}): Promise<string | undefined> {
  if (!opts.videoUrl) return undefined;
  try {
    const res = await opts.fetchFn(opts.videoUrl, { signal: AbortSignal.timeout(60_000) });
    if (!res.ok) return opts.videoUrl;
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.byteLength < MIN_BYTES) return opts.videoUrl;
    mkdirSync(blipsMediaDir(opts.dataDir), { recursive: true });
    writeFileSync(blipsMediaPath(opts.dataDir, opts.mintIndex), buf);
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
