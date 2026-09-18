import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { handleBlip } from '../mcp/src/blip.js';
import { makeCtx } from './helpers.js';
import {
  archivePlantVideo,
  hangarMediaUrl,
  isHangarTapeUrl,
  mediaFileResponse,
  parseMediaMintIndex,
  readBlipMedia,
} from '../mcp/src/blips-media.js';

describe('durable blip media', () => {
  it('isHangarTapeUrl only matches hangar media', () => {
    expect(isHangarTapeUrl('https://clearing.rippel.ai/v1/blip/media/0.mp4')).toBe(true);
    expect(isHangarTapeUrl('https://blip-plant-production.up.railway.app/artifacts/x.mp4')).toBe(false);
  });

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

  it('migrate is unauthorized without operator token', async () => {
    const ctx = makeCtx();
    const res = await handleBlip(
      new Request('https://api.clearing.dev/v1/blip/migrate', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ tokenId: 0, picture: 'still' }),
      }),
      ctx,
    );
    expect(res?.status).toBe(401);
  });

  it('migrate remasters onto hangar media with operator token', async () => {
    const prev = process.env.CLEARING_OPERATOR_TOKEN;
    process.env.CLEARING_OPERATOR_TOKEN = 'test-op';
    const dir = mkdtempSync(join(tmpdir(), 'blip-mig-'));
    const bytes = Buffer.alloc(1024, 3);
    const ctx = makeCtx(
      {
        'https://artifacts.clearing.dev/blip/still.mp4': {
          body: bytes.toString('latin1'),
          contentType: 'video/mp4',
        },
      },
      { persist: true, config: { dataDir: dir } },
    );
    const res = await handleBlip(
      new Request('https://api.clearing.dev/v1/blip/migrate', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: 'Bearer test-op',
        },
        body: JSON.stringify({
          tokenId: 3,
          picture: 'still',
          brief: 'warehouse floor',
          ownerWallet: '0x00552afc18275c7723dad2EC95d77308738cE07e',
        }),
      }),
      ctx,
    );
    expect(res?.status).toBe(200);
    const body = (await res!.json()) as { videoUrl?: string; remaster?: boolean };
    expect(body.remaster).toBe(true);
    expect(body.videoUrl).toContain('/v1/blip/media/3.mp4');
    expect(readBlipMedia(dir, 3)?.byteLength).toBe(1024);
    const meta = await handleBlip(new Request('https://api.clearing.dev/v1/blip/metadata/3'), ctx);
    const md = (await meta!.json()) as { animation_url?: string; image?: string };
    expect(md.animation_url).toContain('/v1/blip/media/3.mp4');
    expect(md.image).toContain('/v1/blip/poster/3.jpg');
    if (prev === undefined) delete process.env.CLEARING_OPERATOR_TOKEN;
    else process.env.CLEARING_OPERATOR_TOKEN = prev;
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
