const AI_AGENTS = ['*', 'GPTBot', 'Google-Extended', 'ChatGPT-User', 'CCBot', 'ClaudeBot', 'PerplexityBot', 'Grok'];

export function isPathDisallowed(robotsTxt: string, path: string, userAgents: string[] = AI_AGENTS): boolean {
  const groups = parseRobots(robotsTxt);
  const matched = userAgents
    .map((ua) => groups.get(ua.toLowerCase()))
    .filter((g): g is { disallow: string[]; allow: string[] } => Boolean(g));
  const star = groups.get('*');
  const rules = matched.length > 0 ? matched : star ? [star] : [];
  for (const group of rules) {
    if (ruleHits(path, group.disallow) && !ruleHits(path, group.allow)) return true;
  }
  return false;
}

function parseRobots(text: string): Map<string, { disallow: string[]; allow: string[] }> {
  const groups = new Map<string, { disallow: string[]; allow: string[] }>();
  let current: string[] = [];
  const ensure = (ua: string) => {
    const key = ua.toLowerCase();
    if (!groups.has(key)) groups.set(key, { disallow: [], allow: [] });
    return groups.get(key)!;
  };
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.split('#')[0]?.trim() ?? '';
    if (!line) continue;
    const idx = line.indexOf(':');
    if (idx < 0) continue;
    const key = line.slice(0, idx).trim().toLowerCase();
    const value = line.slice(idx + 1).trim();
    if (key === 'user-agent') {
      current = [value];
      ensure(value);
    } else if (key === 'disallow' && current.length) {
      for (const ua of current) ensure(ua).disallow.push(value);
    } else if (key === 'allow' && current.length) {
      for (const ua of current) ensure(ua).allow.push(value);
    }
  }
  return groups;
}

function ruleHits(path: string, rules: string[]): boolean {
  return rules.some((rule) => {
    if (rule === '') return false;
    if (rule === '/') return true;
    return path.startsWith(rule);
  });
}

export function hasNoAiSignal(html: string, headers?: Headers): boolean {
  const robotsHeader = headers?.get('x-robots-tag') ?? headers?.get('X-Robots-Tag') ?? '';
  if (/(?:^|[,;])\s*(?:noai|noimageai|noarchive)\b/i.test(robotsHeader)) return true;
  if (/<meta[^>]+name=["']robots["'][^>]+content=["'][^"']*(noai|noimageai)[^"']*["']/i.test(html)) {
    return true;
  }
  if (/<meta[^>]+content=["'][^"']*(noai|noimageai)[^"']*["'][^>]+name=["']robots["']/i.test(html)) {
    return true;
  }
  if (/<meta[^>]+name=["']tdm-reservation["'][^>]+content=["']1["']/i.test(html)) return true;
  return false;
}
