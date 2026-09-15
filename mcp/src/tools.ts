/**
 * Tool surface — transport-free, same split as postalocity-mcp/src/lib/mcp-server.ts.
 * Unprefixed names; Grok namespaces as clearing__*. Also accept the prefixed form.
 */
import { z } from 'zod';
import { discover } from './discover.js';
import { ClearingError } from './errors.js';
import { fetchPaid } from './pay.js';
import { listReceipts, statusPayload } from './receipts.js';
import { blipPriceUsd } from './blips-escalator.js';
import type { ClearingContext } from './context.js';

const DiscoverSchema = z.object({
  query: z.string().optional(),
  category: z.enum(['extract', 'api', 'mcp']).optional(),
  limit: z.number().int().min(1).max(50).optional(),
});

const ExtractSchema = z.object({
  url: z.string().url(),
  js: z.boolean().optional(),
  schema: z.enum(['markdown', 'json']).optional(),
  dryRun: z.boolean().optional(),
  paymentId: z.string().uuid().optional(),
  approved: z.boolean().optional(),
  maxUsd: z.number().positive().optional(),
});

const FetchPaidSchema = z.object({
  url: z.string().url(),
  maxUsd: z.number().positive(),
  paymentId: z.string().uuid().optional(),
  dryRun: z.boolean().optional(),
  approved: z.boolean().optional(),
});

const ReceiptsSchema = z.object({
  since: z.string().optional(),
  paymentId: z.string().optional(),
});

const BlipSchema = z.object({
  picture: z.string(),
  brief: z.string(),
  style: z.string().optional(),
  owner: z.string().optional(),
  dryRun: z.boolean().optional(),
  paymentId: z.string().uuid().optional(),
  approved: z.boolean().optional(),
  maxUsd: z.number().positive().optional(),
});

export const TOOL_DEFINITIONS = [
  {
    name: 'status',
    description: 'Clearing signer backend, masked addresses, remaining caps, last receipts. No side effects.',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'discover',
    description:
      'List x402 services that have a heartbeat and a recent real USDC settlement. Never returns registration-only ERC-8004 ids.',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string' },
        category: { type: 'string', enum: ['extract', 'api', 'mcp'] },
        limit: { type: 'number', minimum: 1, maximum: 50 },
      },
    },
  },
  {
    name: 'extract',
    description:
      'Buy a receipted markdown+JSON extract for a URL via x402. Convenience wrapper around fetch_paid to the extract endpoint; not a second price. dry_run defaults true.',
    inputSchema: {
      type: 'object',
      properties: {
        url: { type: 'string', description: 'Page URL to extract' },
        js: { type: 'boolean' },
        schema: { type: 'string', enum: ['markdown', 'json'] },
        dryRun: { type: 'boolean', description: 'Default true. No spend when true.' },
        paymentId: { type: 'string' },
        approved: { type: 'boolean' },
        maxUsd: { type: 'number' },
      },
      required: ['url'],
    },
  },
  {
    name: 'fetch_paid',
    description:
      'GET a 402 resource through the signer rail. Idempotent paymentId. Caps enforced locally. dry_run defaults true. --always-approve is ignored.',
    inputSchema: {
      type: 'object',
      properties: {
        url: { type: 'string' },
        maxUsd: { type: 'number' },
        paymentId: { type: 'string' },
        dryRun: { type: 'boolean' },
        approved: { type: 'boolean' },
      },
      required: ['url', 'maxUsd'],
    },
  },
  {
    name: 'receipts',
    description: 'Local receipt ledger (paymentId, tx, origin, amount). replayed rows do not increment caps.',
    inputSchema: {
      type: 'object',
      properties: {
        since: { type: 'string' },
        paymentId: { type: 'string' },
      },
    },
  },
  {
    name: 'blip',
    description:
      'Mint a 4.44s Blip at the hangar: x402 quote then factory plant blip + Base ERC-721 to the payer wallet. picture=still|motion:<id>. Escalator LOCKED quadratic. dry_run defaults true. Not a marketplace.',
    inputSchema: {
      type: 'object',
      properties: {
        picture: { type: 'string', description: 'still or motion:<id> (orb swirl snap waves spark)' },
        brief: { type: 'string' },
        style: { type: 'string' },
        owner: { type: 'string', description: 'Payer wallet if the payload has no eip3009.from' },
        dryRun: { type: 'boolean', description: 'Default true. No spend when true.' },
        paymentId: { type: 'string' },
        approved: { type: 'boolean' },
        maxUsd: { type: 'number' },
      },
      required: ['picture', 'brief'],
    },
  },
] as const;

export const TOOL_NAMES = TOOL_DEFINITIONS.map((t) => t.name);

export function canonicalToolName(name: string): string {
  return name.startsWith('clearing__') ? name.slice('clearing__'.length) : name;
}

export async function handleTool(
  name: string,
  args: Record<string, unknown> | undefined,
  ctx: ClearingContext,
): Promise<unknown> {
  const tool = canonicalToolName(name);
  const a = args ?? {};
  switch (tool) {
    case 'status':
      return statusPayload(ctx);
    case 'discover': {
      const parsed = DiscoverSchema.parse(a);
      return discover(parsed, ctx);
    }
    case 'extract': {
      const parsed = ExtractSchema.parse(a);
      const js = parsed.js === true;
      const price = js ? ctx.config.extractPriceJsUsd : ctx.config.extractPriceUsd;
      const extractUrl = `${ctx.config.extractBaseUrl}/v1/extract?url=${encodeURIComponent(parsed.url)}&js=${js ? '1' : '0'}`;
      const result = await fetchPaid(
        {
          url: extractUrl,
          maxUsd: parsed.maxUsd ?? price,
          paymentId: parsed.paymentId,
          dryRun: parsed.dryRun,
          approved: parsed.approved,
        },
        ctx,
      );
      if (parsed.schema === 'markdown' && result.body && typeof result.body === 'object') {
        return { ...result, markdown: (result.body as { markdown?: string }).markdown };
      }
      return result;
    }
    case 'fetch_paid': {
      const parsed = FetchPaidSchema.parse(a);
      return fetchPaid(parsed, ctx);
    }
    case 'receipts': {
      const parsed = ReceiptsSchema.parse(a);
      return listReceipts(parsed, ctx);
    }
    case 'blip': {
      const parsed = BlipSchema.parse(a);
      const mintIndex = ctx.blips.count();
      const price = blipPriceUsd(mintIndex);
      const params = new URLSearchParams({ picture: parsed.picture, brief: parsed.brief });
      if (parsed.style) params.set('style', parsed.style);
      if (parsed.owner) params.set('owner', parsed.owner);
      const blipUrl = `${ctx.config.extractBaseUrl}/v1/blip?${params.toString()}`;
      return fetchPaid(
        {
          url: blipUrl,
          maxUsd: parsed.maxUsd ?? Math.max(price, 0.05),
          paymentId: parsed.paymentId,
          dryRun: parsed.dryRun,
          approved: parsed.approved,
        },
        ctx,
      );
    }
    default:
      throw new ClearingError('unknown_tool', `Unknown tool: ${name}`, 404);
  }
}
