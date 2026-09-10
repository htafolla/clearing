import { normalizeAddress } from './bytes.js';
import { parseHttpUrl } from './origin.js';
import { probeUrl } from './probes.js';
import { daysAgoIso } from './settlement.js';
import { atomicToUsd } from './x402.js';
import type { ClearingContext } from './context.js';
import type { DiscoverCategory, DiscoveredService, WatchlistItem } from './types.js';

export type DiscoverArgs = {
  query?: string;
  category?: DiscoverCategory;
  limit?: number;
};

export async function discover(args: DiscoverArgs, ctx: ClearingContext): Promise<DiscoveredService[]> {
  const now = ctx.now();
  const since = daysAgoIso(now, 7);
  const live = new Set<string>();
  const rows: DiscoveredService[] = [];
  const q = args.query?.toLowerCase();

  for (const item of ctx.watchlist.list()) {
    if (args.category && item.category !== args.category) continue;
    if (q && !matchesQuery(item, q)) continue;
    const lastProbeMs = item.lastProbeAt ? Date.parse(item.lastProbeAt) : 0;
    const stale = !item.lastProbeAt || now.getTime() - lastProbeMs >= ctx.config.probeIntervalMs;
    if ((item.failCount ?? 0) >= 2 && !stale) continue;

    const card = await loadCard(item, ctx);
    if (!card) {
      noteFail(item, ctx, now);
      continue;
    }
    const endpoint = pickEndpoint(card, item);
    if (!endpoint) {
      noteFail(item, ctx, now);
      continue;
    }

    const probe = await probeUrl(endpoint, ctx);
    if (!probe.ok || !probe.quote) {
      noteFail(item, ctx, now);
      continue;
    }

    ctx.watchlist.update(item.id, {
      failCount: 0,
      lastProbeOk: true,
      lastProbeAt: now.toISOString(),
      lastLatencyMs: probe.latencyMs,
    });

    const transfers = ctx.settlements
      .transfersTo(probe.quote.payTo, since)
      .filter((t) => t.tag !== 'soak')
      .filter((t) => !ctx.config.soakFromAddresses.includes(normalizeAddress(t.from)));
    if (transfers.length < ctx.config.discoverMinSettlements7d) continue;

    const payers = new Set(transfers.map((t) => t.from));
    const parsed = parseHttpUrl(endpoint);
    live.add(parsed.origin.toLowerCase());
    live.add(parsed.hostname.toLowerCase());
    rows.push({
      origin: parsed.origin.toLowerCase(),
      url: endpoint,
      category: item.category,
      payTo: probe.quote.payTo,
      asset: probe.quote.asset,
      amountUsd: String(atomicToUsd(probe.quote.maxAmountRequired)),
      settlements7d: transfers.length,
      probeLatencyMs: probe.latencyMs,
      thinLiquidity: payers.size < 2,
    });
  }

  ctx.setLiveDiscoverOrigins(live);
  rows.sort((a, b) => {
    if (b.settlements7d !== a.settlements7d) return b.settlements7d - a.settlements7d;
    if (a.probeLatencyMs !== b.probeLatencyMs) return a.probeLatencyMs - b.probeLatencyMs;
    return Number(a.amountUsd) - Number(b.amountUsd);
  });
  const limit = args.limit ?? 20;
  return rows.slice(0, Math.min(Math.max(limit, 1), 50));
}

function noteFail(item: WatchlistItem, ctx: ClearingContext, now: Date): void {
  ctx.watchlist.update(item.id, {
    failCount: (item.failCount ?? 0) + 1,
    lastProbeOk: false,
    lastProbeAt: now.toISOString(),
  });
}

function matchesQuery(item: WatchlistItem, q: string): boolean {
  return `${item.origin} ${item.url} ${item.erc8004Id ?? ''} ${item.cardUrl ?? ''}`.toLowerCase().includes(q);
}

async function loadCard(item: WatchlistItem, ctx: ClearingContext): Promise<Record<string, unknown> | undefined> {
  const origin = item.origin.replace(/\/$/, '');
  const cardUrl = item.cardUrl ?? `${origin}/.well-known/agent.json`;
  try {
    const res = await ctx.fetch(cardUrl, { signal: AbortSignal.timeout(ctx.config.probeTimeoutMs) });
    if (!res.ok) return undefined;
    const body = (await res.json()) as unknown;
    if (typeof body !== 'object' || body === null) return undefined;
    return body as Record<string, unknown>;
  } catch {
    return undefined;
  }
}

function pickEndpoint(card: Record<string, unknown>, item: WatchlistItem): string | undefined {
  const candidates: unknown[] = [item.url];
  const endpoints = card.endpoints;
  if (endpoints && typeof endpoints === 'object') {
    const rec = endpoints as Record<string, unknown>;
    candidates.push(rec.http, rec.mcp, rec.extract);
  }
  candidates.push(card.url);
  const services = card.services;
  if (Array.isArray(services)) {
    for (const svc of services) {
      if (svc && typeof svc === 'object') candidates.push((svc as { endpoint?: unknown }).endpoint);
    }
  }
  for (const c of candidates) {
    if (typeof c !== 'string' || !c) continue;
    try {
      parseHttpUrl(c);
      return c;
    } catch {
      /* registration-only ids are not HTTP */
    }
  }
  return undefined;
}
