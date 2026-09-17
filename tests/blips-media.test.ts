import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  archivePlantVideo,
  hangarMediaUrl,
  mediaFileResponse,
  parseMediaMintIndex,
  readBlipMedia,
} from '../mcp/src/blips-media.js';

describe('durable blip media', () => {
  it('parses /v1/blip/media/:id.mp4', () => {
    expect(parseMediaMintIndex('/v1/blip/media/11.mp4')).toBe(11);
    expect(parseMediaMintIndex('/v1/blip/media/0')).toBe(0);
    expect(parseMediaMintIndex('/v1/blip/owned')).toBeUndefined();
  });

  it('copies plant bytes onto dataDir and returns hangar URL', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'blip-media-'));
    const bytes = Buffer.alloc(1024, 7);
    const url = await archivePlantVideo({
      videoUrl: 'https://plant.example/artifacts/gone.mp4',
      dataDir: dir,
      mintIndex: 23,
      publicBase: 'https://clearing.rippel.ai',
      fetchFn: async () => new Response(bytes, { status: 200, headers: { 'content-type': 'video/mp4' } }),
    });
    expect(url).toBe(hangarMediaUrl('https://clearing.rippel.ai', 23));
    expect(url).toMatch(/\.mp4$/);
    expect(readBlipMedia(dir, 23)?.equals(bytes)).toBe(true);
    const res = mediaFileResponse(readBlipMedia(dir, 23)!, 'bytes=0-9');
    expect(res.status).toBe(206);
    expect(Buffer.from(await res.arrayBuffer()).byteLength).toBe(10);
    rmSync(dir, { recursive: true, force: true });
  });

  it('keeps plant URL if fetch fails', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'blip-media-'));
    const plant = 'https://plant.example/artifacts/x.mp4';
    const url = await archivePlantVideo({
      videoUrl: plant,
      dataDir: dir,
      mintIndex: 1,
      publicBase: 'https://clearing.rippel.ai',
      fetchFn: async () => new Response('nope', { status: 404 }),
    });
    expect(url).toBe(plant);
    rmSync(dir, { recursive: true, force: true });
  });
});
