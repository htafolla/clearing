/**
 * Invoke factory plant `blip` (xray 4.0.15 / d466f1a91 — kapow opt live).
 *
 * Preferred: POST BLIPS_FOUNDRY_URL  { brief, picture, style? }
 * Fallback:  npx @0xray/foundry blip render --brief TEXT --mode still|motion:<id>
 *
 * Clearing does not vendor @0xray/foundry (CONSTRAINTS). Hangar calls the
 * sibling plant; it does not mill-plant or `foundry mint`.
 */
import { spawn } from 'node:child_process';
import { ClearingError } from './errors.js';

export const BLIP_DURATION_SEC = 4.44;
export const BLIP_PLANT_VERSION = 'xray@d466f1a91+kapow';

export type BlipPlantInput = {
  picture: string;
  brief: string;
  style?: string;
  mintIndex?: number;
};

export type BlipPlantResult = {
  ok: boolean;
  videoUrl?: string;
  imageUrl?: string;
  audioUrl?: string;
  durationSec: number;
  picture: string;
  plantVersion: string;
  reason?: string;
};

export interface BlipPlant {
  render(input: BlipPlantInput): Promise<BlipPlantResult>;
}

export class FakeBlipPlant implements BlipPlant {
  last?: BlipPlantInput;
  failNext: string | null = null;
  calls = 0;

  async render(input: BlipPlantInput): Promise<BlipPlantResult> {
    this.calls += 1;
    this.last = input;
    if (this.failNext) {
      const reason = this.failNext;
      this.failNext = null;
      return {
        ok: false,
        durationSec: BLIP_DURATION_SEC,
        picture: input.picture,
        plantVersion: 'fake',
        reason,
      };
    }
    const motion = input.picture === 'still' ? 'still' : input.picture.replace('motion:', '');
    return {
      ok: true,
      videoUrl: `https://artifacts.clearing.dev/blip/${motion}.mp4`,
      imageUrl: `https://artifacts.clearing.dev/blip/${motion}.png`,
      audioUrl: `https://artifacts.clearing.dev/blip/${motion}.wav`,
      durationSec: BLIP_DURATION_SEC,
      picture: input.picture,
      plantVersion: 'fake',
    };
  }
}

export class HttpBlipPlant implements BlipPlant {
  constructor(
    private readonly url: string,
    private readonly fetchFn: typeof fetch,
  ) {}

  async render(input: BlipPlantInput): Promise<BlipPlantResult> {
    const res = await this.fetchFn(this.url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(input),
    });
    if (!res.ok) {
      const text = await res.text();
      return {
        ok: false,
        durationSec: BLIP_DURATION_SEC,
        picture: input.picture,
        plantVersion: BLIP_PLANT_VERSION,
        reason: `foundry service ${res.status}: ${text.slice(0, 200)}`,
      };
    }
    const json = (await res.json()) as Partial<BlipPlantResult> & { receipt?: { status?: string; reason?: string } };
    if (json.receipt && json.receipt.status === 'FAIL') {
      return {
        ok: false,
        durationSec: BLIP_DURATION_SEC,
        picture: input.picture,
        plantVersion: BLIP_PLANT_VERSION,
        reason: json.receipt.reason ?? 'plant FAIL',
      };
    }
    if (json.ok === false) {
      return {
        ok: false,
        durationSec: Number(json.durationSec ?? BLIP_DURATION_SEC),
        picture: input.picture,
        plantVersion: String(json.plantVersion ?? BLIP_PLANT_VERSION),
        reason: json.reason ?? 'plant FAIL',
      };
    }
    return {
      ok: true,
      videoUrl: json.videoUrl,
      imageUrl: json.imageUrl,
      audioUrl: json.audioUrl,
      durationSec: Number(json.durationSec ?? BLIP_DURATION_SEC),
      picture: String(json.picture ?? input.picture),
      plantVersion: String(json.plantVersion ?? BLIP_PLANT_VERSION),
    };
  }
}

export class CliBlipPlant implements BlipPlant {
  constructor(private readonly command: string[] = defaultFoundryArgv()) {}

  async render(input: BlipPlantInput): Promise<BlipPlantResult> {
    const args = [...this.command, 'blip', 'render', '--brief', input.brief, '--mode', input.picture];
    if (input.style) args.push('--style', input.style);
    const { stdout, stderr, status } = await spawnText(args[0]!, args.slice(1));
    if (status !== 0) {
      return {
        ok: false,
        durationSec: BLIP_DURATION_SEC,
        picture: input.picture,
        plantVersion: BLIP_PLANT_VERSION,
        reason: (stderr || stdout || `foundry exit ${status}`).slice(0, 400),
      };
    }
    try {
      const receipt = JSON.parse(stdout) as {
        status?: string;
        reason?: string;
        durationSec?: number;
        pictureMode?: string;
        mp4?: string;
        videoUrl?: string;
        imageUrl?: string;
        audioUrl?: string;
        out?: string;
      };
      if (receipt.status === 'FAIL') {
        return {
          ok: false,
          durationSec: BLIP_DURATION_SEC,
          picture: input.picture,
          plantVersion: BLIP_PLANT_VERSION,
          reason: receipt.reason ?? 'plant FAIL',
        };
      }
      return {
        ok: true,
        videoUrl: receipt.videoUrl ?? receipt.mp4 ?? receipt.out,
        imageUrl: receipt.imageUrl,
        audioUrl: receipt.audioUrl,
        durationSec: Number(receipt.durationSec ?? BLIP_DURATION_SEC),
        picture: receipt.pictureMode ?? input.picture,
        plantVersion: BLIP_PLANT_VERSION,
      };
    } catch {
      throw new ClearingError('plant', 'foundry blip returned non-JSON receipt', 502);
    }
  }
}

export class MissingBlipPlant implements BlipPlant {
  async render(input: BlipPlantInput): Promise<BlipPlantResult> {
    return {
      ok: false,
      durationSec: BLIP_DURATION_SEC,
      picture: input.picture,
      plantVersion: BLIP_PLANT_VERSION,
      reason: 'set BLIPS_FOUNDRY_URL (preferred) or BLIPS_FOUNDRY_CLI=1 for `npx @0xray/foundry blip render`',
    };
  }
}

export function createBlipPlant(opts: { fetchFn?: typeof fetch; allowFake?: boolean } = {}): BlipPlant {
  const service = process.env.BLIPS_FOUNDRY_URL?.trim();
  if (service) return new HttpBlipPlant(service, opts.fetchFn ?? fetch);
  if (process.env.BLIPS_FOUNDRY_CLI === '1' || process.env.BLIPS_FOUNDRY_BIN) {
    return new CliBlipPlant(defaultFoundryArgv());
  }
  if (opts.allowFake) return new FakeBlipPlant();
  return new MissingBlipPlant();
}

function defaultFoundryArgv(): string[] {
  const bin = process.env.BLIPS_FOUNDRY_BIN?.trim();
  if (bin) return bin.split(/\s+/);
  return ['npx', '--yes', '@0xray/foundry'];
}

function spawnText(cmd: string, args: string[]): Promise<{ stdout: string; stderr: string; status: number }> {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    const out: Buffer[] = [];
    const err: Buffer[] = [];
    child.stdout.on('data', (c: Buffer) => out.push(c));
    child.stderr.on('data', (c: Buffer) => err.push(c));
    child.on('error', reject);
    child.on('close', (code) => {
      resolve({
        stdout: Buffer.concat(out).toString('utf8'),
        stderr: Buffer.concat(err).toString('utf8'),
        status: code ?? 1,
      });
    });
  });
}
