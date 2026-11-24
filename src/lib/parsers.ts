import type { DeepLink, ScopedRobotsRule } from './types.ts';

export interface ParsedHtmlMetadata {
  title: string;
  description: string;
  generator: string;
  ogTitle: string;
  ogDescription: string;
  ogImage?: string;
  iconUrl?: string;
  nextHref?: string;
  hasSphinxSignature: boolean;
  hasStarlightSignature: boolean;
  firstParagraph: string;
  navLinks: DeepLink[];
  internalPageLinks: string[];
  jsonLdObjects: Record<string, unknown>[];
}

const HTML_ENTITIES: Record<string, string> = {
  '&amp;': '&',
  '&lt;': '<',
  '&gt;': '>',
  '&quot;': '"',
  '&#39;': "'",
  '&#x27;': "'",
  '&nbsp;': ' ',
  '&middot;': '·',
  '&mdash;': '—',
  '&ndash;': '–',
  '&rarr;': '→',
};

export function decodeEntities(raw: string): string {
  return raw
    .replace(/&[a-zA-Z0-9#]+;/g, (entity) => {
      if (entity in HTML_ENTITIES) return HTML_ENTITIES[entity];
      if (entity.startsWith('&#x') || entity.startsWith('&#X')) {
        const code = Number.parseInt(entity.slice(3, -1), 16);
        return Number.isFinite(code) ? String.fromCodePoint(code) : entity;
      }
      if (entity.startsWith('&#')) {
        const code = Number.parseInt(entity.slice(2, -1), 10);
        return Number.isFinite(code) ? String.fromCodePoint(code) : entity;
      }
      return entity;
    })
    .replace(/\s+/g, ' ')
    .trim();
}

export function stripHtmlTags(raw: string): string {
  return decodeEntities(
    raw
      .replace(/<script[\s\S]*?<\/script>/gi, ' ')
      .replace(/<style[\s\S]*?<\/style>/gi, ' ')
      .replace(/<svg[\s\S]*?<\/svg>/gi, ' ')
      .replace(/<[^>]+>/g, ' '),
  )
    .replace(/[¶#]+$/g, '')
    .trim();
}

export function parseTagAttributes(attrChunk: string): Record<string, string> {
  const attrs: Record<string, string> = {};
  const attrRegex =
    /([a-zA-Z_:][-a-zA-Z0-9_:.]*)\s*(?:=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g;
  for (const match of attrChunk.matchAll(attrRegex)) {
    const key = match[1]?.toLowerCase();
    if (!key) continue;
    const val = match[2] ?? match[3] ?? match[4] ?? '';
    attrs[key] = decodeEntities(val);
  }
  return attrs;
}

export function resolveUrlSafe(href: string, baseUrl: string): string | undefined {
  const trimmed = href.trim();
  if (
    !trimmed ||
    trimmed.startsWith('#') ||
    trimmed.startsWith('mailto:') ||
    trimmed.startsWith('tel:') ||
    trimmed.startsWith('javascript:') ||
    trimmed.startsWith('data:')
  ) {
    return undefined;
  }
  try {
    return new URL(trimmed, baseUrl).toString();
  } catch {
    return undefined;
  }
}

export function parseHtmlDocument(html: string, pageUrl: string): ParsedHtmlMetadata {
  const normalizedBase = pageUrl.endsWith('/') ? pageUrl : `${pageUrl}/`;
  const titleMatch = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  const title = titleMatch ? stripHtmlTags(titleMatch[1] ?? '') : '';

  let description = '';
  let generator = '';
  let ogTitle = '';
  let ogDescription = '';
  let ogImage: string | undefined;

  for (const metaMatch of html.matchAll(/<meta\b([^>]*?)\/?>/gi)) {
    const attrs = parseTagAttributes(metaMatch[1] ?? '');
    const name = (attrs.name ?? '').toLowerCase();
    const prop = (attrs.property ?? '').toLowerCase();
    const content = (attrs.content ?? '').trim();
    if (!content) continue;
    if (name === 'description' && !description) description = content;
    if (name === 'generator' && !generator) generator = content;
    if (prop === 'og:title' && !ogTitle) ogTitle = content;
    if (prop === 'og:description' && !ogDescription) ogDescription = content;
    if (prop === 'og:image' && !ogImage) {
      ogImage = resolveUrlSafe(content, normalizedBase);
    }
  }

  let iconUrl: string | undefined;
  let nextHref: string | undefined;
  for (const linkMatch of html.matchAll(/<link\b([^>]*?)\/?>/gi)) {
    const attrs = parseTagAttributes(linkMatch[1] ?? '');
    const relTokens = new Set((attrs.rel ?? '').toLowerCase().split(/\s+/).filter(Boolean));
    const href = attrs.href ?? '';
    if (!href) continue;
    if ((relTokens.has('icon') || relTokens.has('shortcut')) && !iconUrl) {
      iconUrl = resolveUrlSafe(href, normalizedBase);
    }
    if (relTokens.has('next') && !nextHref) {
      nextHref = href;
    }
  }

  const hasSphinxSignature =
    /Generated with Sphinx/i.test(html) ||
    /documentation_options\.js/i.test(html) ||
    /toctree-l1/i.test(html);
  const hasStarlightSignature =
    /starlight/i.test(html) || /astro/i.test(generator) || /data-theme=/i.test(html);

  const jsonLdObjects: Record<string, unknown>[] = [];
  for (const scriptMatch of html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)) {
    const attrs = parseTagAttributes(scriptMatch[1] ?? '');
    if ((attrs.type ?? '').toLowerCase() !== 'application/ld+json') continue;
    const rawJson = (scriptMatch[2] ?? '').trim();
    if (!rawJson) continue;
    try {
      const parsed: unknown = JSON.parse(rawJson);
      const items = Array.isArray(parsed) ? parsed : [parsed];
      for (const item of items) {
        if (item && typeof item === 'object') {
          const obj = item as Record<string, unknown>;
          if (Array.isArray(obj['@graph'])) {
            for (const node of obj['@graph']) {
              if (node && typeof node === 'object') {
                jsonLdObjects.push(node as Record<string, unknown>);
              }
            }
          } else {
            jsonLdObjects.push(obj);
          }
        }
      }
    } catch {
      // Ignore malformed JSON-LD blocks on third-party pages
    }
  }

  // Extract first substantial paragraph inside <main> or <article>
  const mainSliceMatch =
    html.match(/<main\b[^>]*>([\s\S]*?)<\/main>/i) ??
    html.match(/<article\b[^>]*>([\s\S]*?)<\/article>/i);
  const proseScope = mainSliceMatch ? (mainSliceMatch[1] ?? '') : html;
  let firstParagraph = '';
  for (const pMatch of proseScope.matchAll(/<p\b[^>]*>([\s\S]*?)<\/p>/gi)) {
    const clean = stripHtmlTags(pMatch[1] ?? '');
    if (clean.length >= 45 && !clean.startsWith('Copyright')) {
      firstParagraph = clean;
      break;
    }
  }

  // Collect structured navigation links (Starlight top nav, Sphinx toctree-l1, or primary <nav>)
  const navLinks: DeepLink[] = [];
  const seenNavUrls = new Set<string>();
  const addNavCandidate = (rawHref: string, rawLabel: string): void => {
    const resolved = resolveUrlSafe(rawHref, normalizedBase);
    if (!resolved?.startsWith(normalizedBase)) return;
    const cleanUrl = resolved.split('#')[0] ?? resolved;
    if (cleanUrl === normalizedBase || seenNavUrls.has(cleanUrl)) return;
    const label = stripHtmlTags(rawLabel);
    if (!label || label.length > 42) return;
    seenNavUrls.add(cleanUrl);
    navLinks.push({ label, url: cleanUrl });
  };

  for (const liMatch of html.matchAll(
    /<li\b[^>]*class="[^"]*toctree-l1[^"]*"[^>]*>\s*<a\b([^>]*)>([\s\S]*?)<\/a>/gi,
  )) {
    const attrs = parseTagAttributes(liMatch[1] ?? '');
    if (attrs.href) addNavCandidate(attrs.href, liMatch[2] ?? '');
  }

  for (const navBlock of html.matchAll(/<nav\b[^>]*>([\s\S]*?)<\/nav>/gi)) {
    for (const aMatch of (navBlock[1] ?? '').matchAll(/<a\b([^>]*)>([\s\S]*?)<\/a>/gi)) {
      const attrs = parseTagAttributes(aMatch[1] ?? '');
      if (attrs.href) addNavCandidate(attrs.href, aMatch[2] ?? '');
    }
  }

  // Collect all same-prefix internal HTML page links for optional BFS crawling or enrichment
  const internalPageLinks: string[] = [];
  const seenInternal = new Set<string>();
  for (const aMatch of html.matchAll(/<a\b([^>]*)>([\s\S]*?)<\/a>/gi)) {
    const attrs = parseTagAttributes(aMatch[1] ?? '');
    if (!attrs.href) continue;
    const resolved = resolveUrlSafe(attrs.href, normalizedBase);
    if (!resolved?.startsWith(normalizedBase)) continue;
    const withoutHash = (resolved.split('#')[0] ?? resolved).split('?')[0] ?? resolved;
    if (
      /\.(png|jpe?g|gif|webp|avif|svg|css|js|json|xml|txt|zip|tar|gz|whl|pdf)$/i.test(withoutHash)
    ) {
      continue;
    }
    if (!seenInternal.has(withoutHash)) {
      seenInternal.add(withoutHash);
      internalPageLinks.push(withoutHash);
    }
    if (navLinks.length < 6) {
      addNavCandidate(attrs.href, aMatch[2] ?? '');
    }
  }

  return {
    title,
    description,
    generator,
    ogTitle,
    ogDescription,
    ogImage,
    iconUrl,
    nextHref,
    hasSphinxSignature,
    hasStarlightSignature,
    firstParagraph,
    navLinks: navLinks.slice(0, 6),
    internalPageLinks,
    jsonLdObjects,
  };
}

export interface ParsedSitemapXml {
  kind: 'sitemapindex' | 'urlset' | 'invalid';
  locs: string[];
}

export function inspectSitemapXml(rawXml: string): ParsedSitemapXml {
  const trimmed = rawXml.trim();
  if (!trimmed) return { kind: 'invalid', locs: [] };

  const isIndex = /<\s*(?:[a-zA-Z0-9_-]+:)?sitemapindex\b/i.test(trimmed);
  const isUrlset = /<\s*(?:[a-zA-Z0-9_-]+:)?urlset\b/i.test(trimmed);
  if (!isIndex && !isUrlset) {
    return { kind: 'invalid', locs: [] };
  }

  const locs: string[] = [];
  for (const match of trimmed.matchAll(
    /<\s*(?:[a-zA-Z0-9_-]+:)?loc\b[^>]*>([\s\S]*?)<\/\s*(?:[a-zA-Z0-9_-]+:)?loc\s*>/gi,
  )) {
    const url = decodeEntities(match[1] ?? '');
    if (url.startsWith('http://') || url.startsWith('https://')) {
      locs.push(url);
    }
  }

  return {
    kind: isIndex ? 'sitemapindex' : 'urlset',
    locs,
  };
}

export interface ScopedRobotsResult {
  sitemapUrls: string[];
  scopedRules: ScopedRobotsRule[];
}

/**
 * Parses a nested project's `/<repo>/robots.txt`, extracts `Sitemap:` lines,
 * and rewrites non-trivial `Disallow:` / `Allow:` directives under `/<repo>/...`
 * while preventing bare `Disallow: /` from de-indexing the root origin.
 */
export function parseAndScopeRobotsTxt(rawRobots: string, repoName: string): ScopedRobotsResult {
  const cleanRepo = repoName.replace(/^\/+|\/+$/g, '');
  const prefix = `/${cleanRepo}`;
  const sitemapUrls: string[] = [];
  const groups: { agents: string[]; allow: string[]; disallow: string[] }[] = [];
  let current: { agents: string[]; allow: string[]; disallow: string[] } | null = null;
  let lastWasAgent = false;

  for (const rawLine of rawRobots.split(/\r?\n/)) {
    const withoutComment = rawLine.split('#')[0]?.trim() ?? '';
    if (!withoutComment) {
      lastWasAgent = false;
      continue;
    }
    const colonIdx = withoutComment.indexOf(':');
    if (colonIdx <= 0) continue;
    const field = withoutComment.slice(0, colonIdx).trim().toLowerCase();
    const value = withoutComment.slice(colonIdx + 1).trim();
    if (!value) continue;

    if (field === 'sitemap') {
      if (value.startsWith('http://') || value.startsWith('https://')) {
        sitemapUrls.push(value);
      }
      continue;
    }

    if (field === 'user-agent') {
      if (!current || !lastWasAgent) {
        current = { agents: [value], allow: [], disallow: [] };
        groups.push(current);
      } else {
        current.agents.push(value);
      }
      lastWasAgent = true;
      continue;
    }

    lastWasAgent = false;
    if (!current) continue;

    const normalizedPath = value.startsWith('/') ? value : `/${value}`;
    if (field === 'disallow') {
      // Safety guard: never allow a nested project's bare `Disallow: /` to block `/` or even the whole portal unintentionally;
      // only carry specific subpath exclusions (e.g. `/_drafts/` -> `/<repo>/_drafts/`).
      if (normalizedPath === '/') continue;
      const scoped = normalizedPath.startsWith(`${prefix}/`)
        ? normalizedPath
        : `${prefix}${normalizedPath}`;
      if (!current.disallow.includes(scoped)) current.disallow.push(scoped);
    } else if (field === 'allow') {
      if (normalizedPath === '/') continue;
      const scoped = normalizedPath.startsWith(`${prefix}/`)
        ? normalizedPath
        : `${prefix}${normalizedPath}`;
      if (!current.allow.includes(scoped)) current.allow.push(scoped);
    }
  }

  const scopedRules: ScopedRobotsRule[] = [];
  for (const group of groups) {
    if (group.allow.length === 0 && group.disallow.length === 0) continue;
    for (const userAgent of group.agents) {
      scopedRules.push({
        project: cleanRepo,
        userAgent,
        allow: [...group.allow],
        disallow: [...group.disallow],
      });
    }
  }

  return { sitemapUrls, scopedRules };
}

/**
 * Parses Sphinx `searchindex.js` (`Search.setIndex({...})`) and converts `docnames`
 * into canonical documentation URLs under `portalUrl`.
 */
export function parseSphinxSearchIndexUrls(
  rawSearchIndexJs: string,
  portalUrl: string,
  dirHtml = true,
): string[] {
  const marker = 'Search.setIndex(';
  const start = rawSearchIndexJs.indexOf(marker);
  const end = rawSearchIndexJs.lastIndexOf(')');
  if (start === -1 || end <= start + marker.length) {
    return [];
  }

  const jsonBody = rawSearchIndexJs.slice(start + marker.length, end).trim();
  let parsed: unknown;
  try {
    parsed = JSON.parse(jsonBody);
  } catch {
    return [];
  }
  if (!parsed || typeof parsed !== 'object') return [];
  const docnames = (parsed as { docnames?: unknown }).docnames;
  if (!Array.isArray(docnames)) return [];

  const base = portalUrl.endsWith('/') ? portalUrl : `${portalUrl}/`;
  const excludedUtilityDocs = new Set(['search', 'genindex', 'py-modindex', 'modindex', '404']);
  const urls = new Set<string>([base]);

  for (const item of docnames) {
    if (typeof item !== 'string') continue;
    const doc = item.trim().replace(/^\/+|\/+$/g, '');
    if (!doc || excludedUtilityDocs.has(doc)) continue;

    if (doc === 'index') {
      urls.add(base);
    } else if (doc.endsWith('/index')) {
      const folder = doc.slice(0, -'/index'.length);
      urls.add(dirHtml ? `${base}${folder}/` : `${base}${doc}.html`);
    } else {
      urls.add(dirHtml ? `${base}${doc}/` : `${base}${doc}.html`);
    }
  }

  return [...urls].sort();
}

/**
 * Parses `window.ALL_CRATES = [...]` from a rustdoc `crates.js` bundle.
 */
export function parseRustdocCratesJs(rawCratesJs: string): string[] {
  const match = rawCratesJs.match(/window\.ALL_CRATES\s*=\s*(\[[\s\S]*?\])\s*;/);
  if (!match?.[1]) return [];
  try {
    const arr: unknown = JSON.parse(match[1]);
    if (!Array.isArray(arr)) return [];
    return arr.filter(
      (item): item is string => typeof item === 'string' && /^[a-zA-Z0-9_-]+$/.test(item),
    );
  } catch {
    return [];
  }
}

export function extractLlmsTxtSummary(rawLlmsTxt: string): {
  excerpt?: string;
  customSliceUrls: DeepLink[];
} {
  const lines = rawLlmsTxt.split(/\r?\n/);
  const quoteLines: string[] = [];
  const customSliceUrls: DeepLink[] = [];

  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.startsWith('>')) {
      quoteLines.push(trimmed.replace(/^>\s*/, '').trim());
    }
    const mdLinkMatch = trimmed.match(/^-\s*\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/);
    if (mdLinkMatch?.[1] && mdLinkMatch[2]?.includes('_llms-txt/')) {
      customSliceUrls.push({
        label: mdLinkMatch[1].trim(),
        url: mdLinkMatch[2].trim(),
      });
    }
  }

  const excerpt = quoteLines.join(' ').trim() || undefined;
  return { excerpt, customSliceUrls: customSliceUrls.slice(0, 6) };
}

export function extractReadmeMetadata(
  rawReadme: string,
  repoName: string,
): {
  installCommand?: string;
  altInstallCommand?: string;
  heroImageUrl?: string;
} {
  let installCommand: string | undefined;
  let altInstallCommand: string | undefined;
  const normRepo = repoName.toLowerCase().replace(/[^a-z0-9]+/g, '');

  for (const m of rawReadme.matchAll(
    /\bpip\s+install\s+(?:-[Uu]\s+)?([a-zA-Z0-9][a-zA-Z0-9_.-]*)/g,
  )) {
    const pkg = m[1] ?? '';
    const normPkg = pkg.toLowerCase().replace(/[^a-z0-9]+/g, '');
    if (
      normPkg &&
      (normPkg === normRepo || normPkg.includes(normRepo) || normRepo.includes(normPkg))
    ) {
      installCommand = `pip install ${pkg}`;
      break;
    }
  }

  for (const m of rawReadme.matchAll(/\bcargo\s+add\s+([a-zA-Z0-9][a-zA-Z0-9_-]*)/g)) {
    const crate = m[1] ?? '';
    const normCrate = crate.toLowerCase().replace(/[^a-z0-9]+/g, '');
    if (
      normCrate &&
      (normCrate === normRepo || normCrate.includes(normRepo) || normRepo.includes(normCrate))
    ) {
      const cmd = `cargo add ${crate}`;
      if (!installCommand) installCommand = cmd;
      else altInstallCommand = cmd;
      break;
    }
  }

  let heroImageUrl: string | undefined;
  for (const imgMatch of rawReadme.slice(0, 2500).matchAll(/<img\b([^>]*?)\/?>/gi)) {
    const attrs = parseTagAttributes(imgMatch[1] ?? '');
    const src = attrs.src ?? '';
    if (!src || src.includes('img.shields.io') || src.includes('badge')) continue;
    if (src.startsWith('https://')) {
      heroImageUrl = src;
      break;
    }
    if (!src.startsWith('http')) {
      const cleanRel = src.replace(/^\.?\//, '');
      heroImageUrl = `https://raw.githubusercontent.com/s0d3s/${repoName}/main/${cleanRel}`;
      break;
    }
  }

  return { installCommand, altInstallCommand, heroImageUrl };
}
