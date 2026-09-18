export function parseSkim(html: string, baseUrl: string, linkCap: number): { title: string; links: string[] } {
  const title =
    textOf(html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] ?? '') ||
    textOf(html.match(/property=["']og:title["'][^>]*content=["']([^"']+)["']/i)?.[1] ?? '') ||
    textOf(html.match(/content=["']([^"']+)["'][^>]*property=["']og:title["']/i)?.[1] ?? '') ||
    '';
  const links: string[] = [];
  const seen = new Set<string>();
  const re = /<a\b[^>]*href=["']([^"'#]+)["'][^>]*>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) && links.length < linkCap) {
    const href = (m[1] ?? '').trim();
    if (!href || href.startsWith('javascript:') || href.startsWith('mailto:')) continue;
    let abs: string;
    try {
      abs = new URL(href, baseUrl).toString();
    } catch {
      continue;
    }
    if (!abs.startsWith('http://') && !abs.startsWith('https://')) continue;
    if (seen.has(abs)) continue;
    seen.add(abs);
    links.push(abs);
  }
  return { title, links };
}

export function htmlToMarkdown(html: string, maxChars: number): { title: string; markdown: string } {
  const title =
    textOf(html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] ?? '') ||
    textOf(html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i)?.[1] ?? '') ||
    '';
  let body = html
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, '');
  const main = body.match(/<article[\s\S]*?<\/article>/i)?.[0] ?? body.match(/<main[\s\S]*?<\/main>/i)?.[0] ?? body;
  let md = main
    .replace(/<h1[^>]*>([\s\S]*?)<\/h1>/gi, (_, t) => `\n# ${textOf(t)}\n`)
    .replace(/<h2[^>]*>([\s\S]*?)<\/h2>/gi, (_, t) => `\n## ${textOf(t)}\n`)
    .replace(/<h3[^>]*>([\s\S]*?)<\/h3>/gi, (_, t) => `\n### ${textOf(t)}\n`)
    .replace(/<a[^>]+href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi, (_, href, t) => `[${textOf(t)}](${href})`)
    .replace(/<li[^>]*>([\s\S]*?)<\/li>/gi, (_, t) => `- ${textOf(t)}\n`)
    .replace(/<p[^>]*>([\s\S]*?)<\/p>/gi, (_, t) => `\n${textOf(t)}\n`)
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, ' ');
  md = decodeEntities(md).replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
  if (title && !md.startsWith('# ')) md = `# ${title}\n\n${md}`;
  if (md.length > maxChars) md = md.slice(0, maxChars);
  return { title, markdown: md };
}

function textOf(value: string): string {
  return decodeEntities(value.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim());
}

function decodeEntities(value: string): string {
  return value
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}
