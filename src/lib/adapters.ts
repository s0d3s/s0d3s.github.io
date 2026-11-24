import {
  extractLlmsTxtSummary,
  inspectSitemapXml,
  type ParsedHtmlMetadata,
  parseAndScopeRobotsTxt,
  parseHtmlDocument,
  parseRustdocCratesJs,
  parseSphinxSearchIndexUrls,
} from './parsers.ts';
import type {
  AdapterChoice,
  DeepLink,
  ExtraAdapterId,
  LlmContextBundle,
  PrimaryAdapterId,
  ProjectOverrideConfig,
  ScopedRobotsRule,
  SynthesizedSitemap,
} from './types.ts';

export interface HttpTextProbeResult {
  ok: boolean;
  status: number;
  contentType: string;
  body: string;
}

export type HttpTextFetcher = (url: string) => Promise<HttpTextProbeResult>;

export interface AdapterInput {
  repoName: string;
  portalUrl: string;
  rootHtml: string;
  parsedRoot: ParsedHtmlMetadata;
  override?: ProjectOverrideConfig;
  fetchText: HttpTextFetcher;
}

export interface AdapterOutput {
  selectedAdapter: PrimaryAdapterId;
  appliedExtraAdapters: ExtraAdapterId[];
  leafSitemapUrls: string[];
  synthesizedSitemaps: SynthesizedSitemap[];
  scopedRobotsRules: ScopedRobotsRule[];
  llmContext: LlmContextBundle;
  deepLinks: DeepLink[];
}

export interface NestedSitePrimaryAdapter {
  readonly id: PrimaryAdapterId;
  detect(input: AdapterInput): Promise<boolean>;
  extract(input: AdapterInput): Promise<{
    leafSitemapUrls: string[];
    synthesizedSitemaps: SynthesizedSitemap[];
    scopedRobotsRules: ScopedRobotsRule[];
    llmContext: LlmContextBundle;
    deepLinks: DeepLink[];
  }>;
}

/**
 * Unwraps native XML sitemaps (`sitemap-index.xml`, `sitemap.xml`, plus any `Sitemap:` URLs
 * declared in `robots.txt`) so ONLY leaf `<urlset>` URLs matching `portalUrl` are returned
 * (never nested `<sitemapindex>` files, which Sitemaps 0.9 forbids).
 */
export async function resolveNativeLeafSitemaps(
  portalUrl: string,
  extraCandidates: string[],
  fetchText: HttpTextFetcher,
): Promise<string[]> {
  const base = portalUrl.endsWith('/') ? portalUrl : `${portalUrl}/`;
  const candidates = new Set<string>([
    ...extraCandidates,
    `${base}sitemap-index.xml`,
    `${base}sitemap.xml`,
  ]);

  const leafUrls = new Set<string>();
  const visited = new Set<string>();

  for (const candidateUrl of candidates) {
    if (!candidateUrl.startsWith(base) || visited.has(candidateUrl)) continue;
    visited.add(candidateUrl);

    const res = await fetchText(candidateUrl);
    if (!res.ok) continue;

    const inspected = inspectSitemapXml(res.body);
    if (inspected.kind === 'urlset') {
      leafUrls.add(candidateUrl);
    } else if (inspected.kind === 'sitemapindex') {
      for (const childLoc of inspected.locs) {
        if (!childLoc.startsWith(base) || visited.has(childLoc)) continue;
        visited.add(childLoc);
        const childRes = await fetchText(childLoc);
        if (!childRes.ok) continue;
        const childInspected = inspectSitemapXml(childRes.body);
        if (childInspected.kind === 'urlset') {
          leafUrls.add(childLoc);
        }
      }
    }
  }

  return [...leafUrls].sort();
}

export async function probeNestedRobotsAndLlms(
  repoName: string,
  portalUrl: string,
  fetchText: HttpTextFetcher,
): Promise<{
  robotsSitemapHints: string[];
  scopedRobotsRules: ScopedRobotsRule[];
  llmContext: LlmContextBundle;
}> {
  const base = portalUrl.endsWith('/') ? portalUrl : `${portalUrl}/`;
  const [robotsRes, llmsRes, llmsFullRes, llmsSmallRes] = await Promise.all([
    fetchText(`${base}robots.txt`),
    fetchText(`${base}llms.txt`),
    fetchText(`${base}llms-full.txt`),
    fetchText(`${base}llms-small.txt`),
  ]);

  let robotsSitemapHints: string[] = [];
  let scopedRobotsRules: ScopedRobotsRule[] = [];
  if (robotsRes.ok && !robotsRes.contentType.includes('text/html')) {
    const parsedRobots = parseAndScopeRobotsTxt(robotsRes.body, repoName);
    robotsSitemapHints = parsedRobots.sitemapUrls;
    scopedRobotsRules = parsedRobots.scopedRules;
  }

  const llmContext: LlmContextBundle = { customSliceUrls: [] };
  if (llmsRes.ok && !llmsRes.contentType.includes('text/html') && llmsRes.body.trim().length > 40) {
    llmContext.llmsTxtUrl = `${base}llms.txt`;
    const summary = extractLlmsTxtSummary(llmsRes.body);
    llmContext.excerpt = summary.excerpt;
    llmContext.customSliceUrls = summary.customSliceUrls;
  }
  if (
    llmsFullRes.ok &&
    !llmsFullRes.contentType.includes('text/html') &&
    llmsFullRes.body.trim().length > 40
  ) {
    llmContext.llmsFullTxtUrl = `${base}llms-full.txt`;
  }
  if (
    llmsSmallRes.ok &&
    !llmsSmallRes.contentType.includes('text/html') &&
    llmsSmallRes.body.trim().length > 40
  ) {
    llmContext.llmsSmallTxtUrl = `${base}llms-small.txt`;
  }

  return { robotsSitemapHints, scopedRobotsRules, llmContext };
}

export const starlightAdapter: NestedSitePrimaryAdapter = {
  id: 'starlight',
  async detect(input: AdapterInput): Promise<boolean> {
    if (input.parsedRoot.hasStarlightSignature) {
      const base = input.portalUrl.endsWith('/') ? input.portalUrl : `${input.portalUrl}/`;
      const sm = await input.fetchText(`${base}sitemap-index.xml`);
      if (sm.ok && inspectSitemapXml(sm.body).kind !== 'invalid') return true;
    }
    return false;
  },
  async extract(input: AdapterInput) {
    const { robotsSitemapHints, scopedRobotsRules, llmContext } = await probeNestedRobotsAndLlms(
      input.repoName,
      input.portalUrl,
      input.fetchText,
    );
    const leafSitemapUrls = await resolveNativeLeafSitemaps(
      input.portalUrl,
      robotsSitemapHints,
      input.fetchText,
    );

    const deepLinks = [...input.parsedRoot.navLinks];
    if (llmContext.llmsFullTxtUrl && deepLinks.length < 6) {
      deepLinks.push({ label: 'llms-full.txt', url: llmContext.llmsFullTxtUrl });
    }

    return {
      leafSitemapUrls,
      synthesizedSitemaps: [],
      scopedRobotsRules,
      llmContext,
      deepLinks: deepLinks.slice(0, 6),
    };
  },
};

export const sphinxAdapter: NestedSitePrimaryAdapter = {
  id: 'sphinx',
  async detect(input: AdapterInput): Promise<boolean> {
    if (input.parsedRoot.hasSphinxSignature) return true;
    const base = input.portalUrl.endsWith('/') ? input.portalUrl : `${input.portalUrl}/`;
    const searchIdx = await input.fetchText(`${base}searchindex.js`);
    return searchIdx.ok && searchIdx.body.includes('Search.setIndex(');
  },
  async extract(input: AdapterInput) {
    const base = input.portalUrl.endsWith('/') ? input.portalUrl : `${input.portalUrl}/`;
    const { robotsSitemapHints, scopedRobotsRules, llmContext } = await probeNestedRobotsAndLlms(
      input.repoName,
      input.portalUrl,
      input.fetchText,
    );
    const leafSitemapUrls = await resolveNativeLeafSitemaps(
      input.portalUrl,
      robotsSitemapHints,
      input.fetchText,
    );

    const synthesizedSitemaps: SynthesizedSitemap[] = [];
    if (leafSitemapUrls.length === 0) {
      const searchIdxRes = await input.fetchText(`${base}searchindex.js`);
      if (searchIdxRes.ok) {
        const nextHref = input.parsedRoot.nextHref ?? '';
        const usesDirHtml = !nextHref.endsWith('.html');
        const urls = parseSphinxSearchIndexUrls(searchIdxRes.body, base, usesDirHtml);
        if (urls.length > 0) {
          const slug = input.repoName.toLowerCase().replace(/[^a-z0-9-]+/g, '-');
          synthesizedSitemaps.push({
            slug,
            filename: `sitemap-${slug}.xml`,
            project: input.repoName,
            sourceAdapter: 'sphinx',
            urls,
          });
        }
      }
    }

    return {
      leafSitemapUrls,
      synthesizedSitemaps,
      scopedRobotsRules,
      llmContext,
      deepLinks: input.parsedRoot.navLinks.slice(0, 6),
    };
  },
};

export const htmlCrawlAdapter: NestedSitePrimaryAdapter = {
  id: 'html-crawl',
  async detect(): Promise<boolean> {
    return true;
  },
  async extract(input: AdapterInput) {
    const base = input.portalUrl.endsWith('/') ? input.portalUrl : `${input.portalUrl}/`;
    const { robotsSitemapHints, scopedRobotsRules, llmContext } = await probeNestedRobotsAndLlms(
      input.repoName,
      input.portalUrl,
      input.fetchText,
    );
    const leafSitemapUrls = await resolveNativeLeafSitemaps(
      input.portalUrl,
      robotsSitemapHints,
      input.fetchText,
    );

    const synthesizedSitemaps: SynthesizedSitemap[] = [];
    if (leafSitemapUrls.length === 0) {
      // Bounded polite 2-level same-prefix BFS crawl when no XML sitemap or Sphinx index exists
      const discovered = new Set<string>([base, ...input.parsedRoot.internalPageLinks]);
      const queue = input.parsedRoot.internalPageLinks.slice(0, 20);
      for (const pageUrl of queue) {
        if (discovered.size >= 80) break;
        const pageRes = await input.fetchText(pageUrl);
        if (!pageRes.ok || !pageRes.contentType.includes('text/html')) continue;
        const parsedSub = parseHtmlDocument(pageRes.body, pageUrl);
        for (const subLink of parsedSub.internalPageLinks) {
          if (discovered.size >= 80) break;
          if (subLink.startsWith(base)) discovered.add(subLink);
        }
      }

      const slug = input.repoName.toLowerCase().replace(/[^a-z0-9-]+/g, '-');
      synthesizedSitemaps.push({
        slug,
        filename: `sitemap-${slug}.xml`,
        project: input.repoName,
        sourceAdapter: 'html-crawl',
        urls: [...discovered].sort(),
      });
    }

    return {
      leafSitemapUrls,
      synthesizedSitemaps,
      scopedRobotsRules,
      llmContext,
      deepLinks: input.parsedRoot.navLinks.slice(0, 6),
    };
  },
};

/**
 * Composable extra adapter that discovers hosted `rustdoc` crate portals under `/<repo>/api/rust/`
 * (auto-detected via `/api/rust/crates.js` or explicit `rustdocCrates`) and synthesizes a clean
 * crate-root `<urlset>` sitemap (`sitemap-<repo>-rustdoc.xml`).
 */
export async function applyRustdocRootsAdapter(input: AdapterInput): Promise<{
  sitemap?: SynthesizedSitemap;
  primaryRustdocUrl?: string;
}> {
  const base = input.portalUrl.endsWith('/') ? input.portalUrl : `${input.portalUrl}/`;
  const subPath = (input.override?.rustdocPath ?? 'api/rust').replace(/^\/+|\/+$/g, '');
  const rustdocBase = `${base}${subPath}/`;

  let crateNames = input.override?.rustdocCrates ? [...input.override.rustdocCrates] : [];
  if (crateNames.length === 0) {
    const cratesJsRes = await input.fetchText(`${rustdocBase}crates.js`);
    if (cratesJsRes.ok) {
      crateNames = parseRustdocCratesJs(cratesJsRes.body);
    }
  }
  if (crateNames.length === 0) {
    return {};
  }

  const verifiedUrls: string[] = [];
  for (const crateName of crateNames) {
    const entryUrl = `${rustdocBase}${crateName}/index.html`;
    const check = await input.fetchText(entryUrl);
    if (check.ok) {
      verifiedUrls.push(entryUrl);
    }
  }

  if (verifiedUrls.length === 0) {
    return {};
  }

  const baseSlug = `${input.repoName.toLowerCase().replace(/[^a-z0-9-]+/g, '-')}-rustdoc`;
  return {
    primaryRustdocUrl: verifiedUrls[0],
    sitemap: {
      slug: baseSlug,
      filename: `sitemap-${baseSlug}.xml`,
      project: input.repoName,
      sourceAdapter: 'rustdoc-roots',
      urls: verifiedUrls.sort(),
    },
  };
}

const PRIMARY_ADAPTERS: readonly NestedSitePrimaryAdapter[] = [
  starlightAdapter,
  sphinxAdapter,
  htmlCrawlAdapter,
];

export async function runProjectSiteAdapters(
  input: AdapterInput,
  defaultAdapter: AdapterChoice = 'auto',
): Promise<AdapterOutput> {
  const requested = input.override?.adapter ?? defaultAdapter;
  let chosen: NestedSitePrimaryAdapter = htmlCrawlAdapter;

  if (requested === 'auto') {
    for (const candidate of PRIMARY_ADAPTERS) {
      if (await candidate.detect(input)) {
        chosen = candidate;
        break;
      }
    }
  } else {
    chosen = PRIMARY_ADAPTERS.find((a) => a.id === requested) ?? htmlCrawlAdapter;
  }

  const primaryOut = await chosen.extract(input);
  const synthesizedSitemaps = [...primaryOut.synthesizedSitemaps];
  const deepLinks = [...primaryOut.deepLinks];
  const appliedExtraAdapters: ExtraAdapterId[] = [];

  // Run `rustdoc-roots` either if explicitly configured OR auto-detected at `/<repo>/api/rust/crates.js`
  const wantsRustdoc =
    input.override?.extraAdapters?.includes('rustdoc-roots') ||
    (requested === 'auto' &&
      (
        await input.fetchText(
          `${input.portalUrl.endsWith('/') ? input.portalUrl : `${input.portalUrl}/`}api/rust/crates.js`,
        )
      ).ok);

  if (wantsRustdoc) {
    const rustdocOut = await applyRustdocRootsAdapter(input);
    if (rustdocOut.sitemap) {
      appliedExtraAdapters.push('rustdoc-roots');
      synthesizedSitemaps.push(rustdocOut.sitemap);
      if (
        rustdocOut.primaryRustdocUrl &&
        !deepLinks.some((d) => d.url === rustdocOut.primaryRustdocUrl) &&
        deepLinks.length < 6
      ) {
        deepLinks.push({ label: 'Rustdoc API', url: rustdocOut.primaryRustdocUrl });
      }
    }
  }

  return {
    selectedAdapter: chosen.id,
    appliedExtraAdapters,
    leafSitemapUrls: primaryOut.leafSitemapUrls,
    synthesizedSitemaps,
    scopedRobotsRules: primaryOut.scopedRobotsRules,
    llmContext: primaryOut.llmContext,
    deepLinks,
  };
}
