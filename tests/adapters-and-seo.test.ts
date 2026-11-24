import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';
import { describe, expect, it } from 'vitest';
import { type HttpTextFetcher, runProjectSiteAdapters } from '../src/lib/adapters.ts';
import { generateFaviconSuite } from '../src/lib/favicons.ts';
import {
  parseAndScopeRobotsTxt,
  parseHtmlDocument,
  parseRustdocCratesJs,
  parseSphinxSearchIndexUrls,
} from '../src/lib/parsers.ts';
import {
  generateLandingJsonLdGraph,
  generateLlmsFullTxt,
  generateLlmsTxt,
  generateRootRobotsTxt,
  generateSitemapIndexXml,
  resolveVisibleContact,
} from '../src/lib/seo-generators.ts';
import { buildTechnicalIndex, loadDiscoverySnapshot } from '../src/lib/snapshot.ts';
import { mergeCatalogWithDynamic } from '../src/lib/telemetry.ts';
import type { DiscoverySnapshot, ProjectsConfig } from '../src/lib/types.ts';
import { verifyBuiltDist } from '../src/lib/verifier.ts';

const TEST_DIR = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(TEST_DIR, '..');

function mockFetcher(
  routes: Record<string, { body: string; contentType?: string }>,
): HttpTextFetcher {
  return async (url: string) => {
    const entry = routes[url];
    if (!entry) {
      return { ok: false, status: 404, contentType: 'text/html', body: 'Not Found' };
    }
    return {
      ok: true,
      status: 200,
      contentType: entry.contentType ?? 'text/plain; charset=utf-8',
      body: entry.body,
    };
  };
}

describe('Pluggable Nested Site Adapters & Auto-Selection', () => {
  it('auto-selects starlight adapter, unwraps nested <sitemapindex>, and discovers rustdoc crate roots', async () => {
    const portalUrl = 'https://s0d3s.github.io/demo-audio/';
    const rootHtml = `<!doctype html><html><head>
      <title>Demo Audio Docs</title>
      <meta name="generator" content="Astro v7.4.13" />
      <meta name="description" content="Cross-platform native audio engine documentation." />
      </head><body>
      <nav><a href="/demo-audio/getting-started/">Getting Started</a><a href="/demo-audio/sdks/">SDKs</a></nav>
      </body></html>`;

    const fetchText = mockFetcher({
      [`${portalUrl}robots.txt`]: {
        body: `User-agent: *\nAllow: /\nDisallow: /_internal/\nSitemap: ${portalUrl}sitemap-index.xml`,
      },
      [`${portalUrl}sitemap-index.xml`]: {
        contentType: 'application/xml',
        body: `<?xml version="1.0" encoding="UTF-8"?><sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"><sitemap><loc>${portalUrl}sitemap-0.xml</loc></sitemap></sitemapindex>`,
      },
      [`${portalUrl}sitemap-0.xml`]: {
        contentType: 'application/xml',
        body: `<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"><url><loc>${portalUrl}</loc></url></urlset>`,
      },
      [`${portalUrl}llms.txt`]: {
        body: `# demo-audio\n\n> Low-latency PCM capture engine for Python and Rust.\n\n- [Python SDK](${portalUrl}_llms-txt/python-sdk.txt)`,
      },
      [`${portalUrl}api/rust/crates.js`]: {
        contentType: 'application/javascript',
        body: 'window.ALL_CRATES = ["demo_audio","demo_audio_core"];',
      },
      [`${portalUrl}api/rust/demo_audio/index.html`]: {
        contentType: 'text/html',
        body: '<html></html>',
      },
      [`${portalUrl}api/rust/demo_audio_core/index.html`]: {
        contentType: 'text/html',
        body: '<html></html>',
      },
    });

    const parsedRoot = parseHtmlDocument(rootHtml, portalUrl);
    const out = await runProjectSiteAdapters({
      repoName: 'demo-audio',
      portalUrl,
      rootHtml,
      parsedRoot,
      fetchText,
    });

    expect(out.selectedAdapter).toBe('starlight');
    expect(out.appliedExtraAdapters).toContain('rustdoc-roots');
    expect(out.leafSitemapUrls).toEqual([`${portalUrl}sitemap-0.xml`]);
    expect(out.synthesizedSitemaps).toHaveLength(1);
    expect(out.synthesizedSitemaps[0]?.urls).toEqual([
      `${portalUrl}api/rust/demo_audio/index.html`,
      `${portalUrl}api/rust/demo_audio_core/index.html`,
    ]);
    expect(out.scopedRobotsRules[0]?.disallow).toEqual(['/demo-audio/_internal/']);
    expect(out.llmContext.customSliceUrls).toHaveLength(1);
  });

  it('auto-selects sphinx adapter and synthesizes dirhtml <urlset> from searchindex.js when native sitemap is missing', async () => {
    const portalUrl = 'https://s0d3s.github.io/demo-icons/';
    const rootHtml = `<!doctype html><html><head>
      <title>Demo Icons 0.2.30</title>
      <link rel="next" title="Concepts" href="concepts/" />
      <!-- Generated with Sphinx 9.1.0 -->
      </head><body>
      <ul><li class="toctree-l1"><a href="concepts/">Concepts</a></li><li class="toctree-l1"><a href="rust/">Rust</a></li></ul>
      </body></html>`;

    const fetchText = mockFetcher({
      [`${portalUrl}searchindex.js`]: {
        contentType: 'application/javascript',
        body: 'Search.setIndex({"docnames":["index","concepts/index","concepts/shaders","rust/index","search","genindex"]})',
      },
    });

    const parsedRoot = parseHtmlDocument(rootHtml, portalUrl);
    const out = await runProjectSiteAdapters({
      repoName: 'demo-icons',
      portalUrl,
      rootHtml,
      parsedRoot,
      fetchText,
    });

    expect(out.selectedAdapter).toBe('sphinx');
    expect(out.leafSitemapUrls).toEqual([]);
    expect(out.synthesizedSitemaps).toHaveLength(1);
    expect(out.synthesizedSitemaps[0]?.filename).toBe('sitemap-demo-icons.xml');
    expect(out.synthesizedSitemaps[0]?.urls).toEqual([
      'https://s0d3s.github.io/demo-icons/',
      'https://s0d3s.github.io/demo-icons/concepts/',
      'https://s0d3s.github.io/demo-icons/concepts/shaders/',
      'https://s0d3s.github.io/demo-icons/rust/',
    ]);
  });

  it('supports explicit per-project adapter override (html-crawl fallback)', async () => {
    const portalUrl = 'https://s0d3s.github.io/custom-docs/';
    const rootHtml = `<!doctype html><html><head><title>Custom Docs</title></head><body>
      <nav><a href="guide/">Guide</a></nav>
      </body></html>`;
    const fetchText = mockFetcher({
      [`${portalUrl}guide/`]: {
        contentType: 'text/html',
        body: '<html><body><a href="advanced/">Advanced</a></body></html>',
      },
    });

    const parsedRoot = parseHtmlDocument(rootHtml, portalUrl);
    const out = await runProjectSiteAdapters({
      repoName: 'custom-docs',
      portalUrl,
      rootHtml,
      parsedRoot,
      override: { adapter: 'html-crawl' },
      fetchText,
    });

    expect(out.selectedAdapter).toBe('html-crawl');
    expect(out.synthesizedSitemaps[0]?.urls).toEqual([
      'https://s0d3s.github.io/custom-docs/',
      'https://s0d3s.github.io/custom-docs/guide/',
      'https://s0d3s.github.io/custom-docs/guide/advanced/',
    ]);
  });
});

describe('Parsers & Protocol Safety Guards', () => {
  it('prevents bare Disallow: / in a nested robots.txt from blocking the root origin', () => {
    const raw = 'User-agent: *\nDisallow: /\nDisallow: /drafts/\nAllow: /drafts/public/';
    const res = parseAndScopeRobotsTxt(raw, 'sub-project');
    expect(res.scopedRules).toHaveLength(1);
    expect(res.scopedRules[0]?.disallow).toEqual(['/sub-project/drafts/']);
    expect(res.scopedRules[0]?.allow).toEqual(['/sub-project/drafts/public/']);
  });

  it('parses Sphinx .html vs dirhtml URL styles accurately', () => {
    const js = 'Search.setIndex({"docnames":["index","api/index","api/core"]})';
    expect(parseSphinxSearchIndexUrls(js, 'https://s0d3s.github.io/proj/', false)).toEqual([
      'https://s0d3s.github.io/proj/',
      'https://s0d3s.github.io/proj/api/core.html',
      'https://s0d3s.github.io/proj/api/index.html',
    ]);
    expect(parseRustdocCratesJs('window.ALL_CRATES = ["alpha","beta_core"];')).toEqual([
      'alpha',
      'beta_core',
    ]);
  });

  it('emits valid RFC 9309 robots.txt, Sitemaps 0.9 index, llms.txt, and Schema.org @graph from snapshot', () => {
    const snapshot = loadDiscoverySnapshot();
    const robots = generateRootRobotsTxt(snapshot);
    expect(robots).toContain('Sitemap: https://s0d3s.github.io/sitemap-index.xml');
    expect(robots).toContain('User-agent: OAI-SearchBot');

    const smIndex = generateSitemapIndexXml(snapshot);
    expect(smIndex).toContain('<sitemapindex');
    expect(smIndex).not.toContain('capture-system-or-process-audio/sitemap-index.xml');
    expect(smIndex).toContain('capture-system-or-process-audio/sitemap-0.xml');
    expect(smIndex).toContain('sitemap-rusty-desktop-icons.xml');

    const llms = generateLlmsTxt(snapshot);
    expect(llms).toContain('capture-system-or-process-audio');
    expect(llms).toContain('rusty-desktop-icons');
    expect(llms).toContain('Trading Platform Architect');
    expect(llms).not.toContain('linkedin.com');

    const techIndex = buildTechnicalIndex(snapshot);
    expect(techIndex.matrixRows).toHaveLength(5);
    expect(techIndex.productPanels.map((p) => p.projectName)).toEqual([
      'capture-system-or-process-audio',
      'rusty-desktop-icons',
    ]);
    const cspaPanel = techIndex.productPanels.find(
      (p) => p.projectName === 'capture-system-or-process-audio',
    );
    expect(cspaPanel?.footerPills.map((c) => c.label)).toEqual([
      'capture',
      'core',
      'windows',
      'linux',
      'macos',
    ]);

    const rdiSitemapUrls = new Set(
      snapshot.synthesizedSitemaps.find((sm) => sm.project === 'rusty-desktop-icons')?.urls ?? [],
    );
    const rdiPanel = techIndex.productPanels.find((p) => p.projectName === 'rusty-desktop-icons');
    for (const track of rdiPanel?.tracks ?? []) {
      for (const link of track.links) {
        expect(rdiSitemapUrls.has(link.url)).toBe(true);
      }
    }
    for (const pill of rdiPanel?.footerPills ?? []) {
      expect(rdiSitemapUrls.has(pill.url)).toBe(true);
    }

    const llmsFull = generateLlmsFullTxt(snapshot, techIndex);
    expect(llmsFull).toContain('## 3. Project & Workload Selection Matrix');
    expect(llmsFull).toContain('## 4. Deep-Dive Documentation by Project');
    expect(llmsFull).toContain('capture_system_or_process_audio_core');

    const graph = generateLandingJsonLdGraph(snapshot);
    expect(graph['@context']).toBe('https://schema.org');
    const graphNodes = graph['@graph'] as Record<string, unknown>[];
    expect(graphNodes.some((n) => n['@type'] === 'FAQPage')).toBe(false);
    const personNode = graphNodes.find((n) => n['@type'] === 'Person');
    expect(personNode?.jobTitle).toContain('Systems Architect');
    expect(personNode?.jobTitle).toContain('Trading Platform Architect');
    expect(personNode?.sameAs).not.toContain('');
  });

  it('keeps LinkedIn invisible by default and activates Email/LinkedIn cleanly via config toggles', async () => {
    const snapshot = loadDiscoverySnapshot();
    const defaultContact = resolveVisibleContact(snapshot.author);
    expect(defaultContact.email).toBe('s0d3s.mail@gmail.com');
    expect(defaultContact.linkedinUrl).toBeUndefined();

    const builtIndex = await fs.readFile(path.join(REPO_ROOT, 'dist', 'index.html'), 'utf-8');
    expect(builtIndex).toContain('data-contact-slot="linkedin" hidden');
    expect(builtIndex).not.toContain('href=""');
    expect(builtIndex).toContain('Monthly OSS Downloads · 340+ Dependent Repos');
    expect(builtIndex).toContain('Ultra-Low-Latency Arch · Zero Wasted Ops');
    expect(builtIndex).toContain('Rust · C++ · Python · Full-Stack Web');
    expect(builtIndex).toContain('Architecture · Team Lead · DevOps/SRE');
    expect(builtIndex).not.toContain('(140,000+ monthly PyPI downloads');
    expect(snapshot.author.theses).toHaveLength(4);

    const withLinkedin = {
      ...snapshot,
      author: {
        ...snapshot.author,
        contact: {
          email: '',
          showEmail: false,
          linkedinUrl: 'https://www.linkedin.com/in/example-handle/',
          showLinkedin: true,
        },
      },
    };
    const toggled = resolveVisibleContact(withLinkedin.author);
    expect(toggled.email).toBeUndefined();
    expect(toggled.linkedinUrl).toBe('https://www.linkedin.com/in/example-handle/');

    const toggledGraph = generateLandingJsonLdGraph(withLinkedin);
    const person = (toggledGraph['@graph'] as Record<string, unknown>[]).find(
      (n) => n['@type'] === 'Person',
    );
    expect(person?.sameAs).toContain('https://www.linkedin.com/in/example-handle/');
    expect(person?.email).toBeUndefined();
    expect(generateLlmsTxt(withLinkedin)).toContain('https://www.linkedin.com/in/example-handle/');
  });
});

describe('Built-Site Verifier & Negative Controls', () => {
  it('passes on built dist/ and catches injected SEO/protocol faults', async () => {
    const realDist = path.join(REPO_ROOT, 'dist');
    const cleanIssues = await verifyBuiltDist(realDist);
    expect(cleanIssues).toEqual([]);

    // Fault-injection negative control on temporary copy
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 's0d3s-verify-neg-'));
    try {
      await fs.cp(realDist, tmpDir, { recursive: true });
      await fs.writeFile(path.join(tmpDir, 'robots.txt'), 'User-agent: *\nDisallow: /\n', 'utf-8');
      await fs.writeFile(
        path.join(tmpDir, 'sitemap-root.xml'),
        '<?xml version="1.0"?><sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"></sitemapindex>',
        'utf-8',
      );
      await fs.writeFile(path.join(tmpDir, 'favicon_1254x1254.png'), 'raw', 'utf-8');
      await fs.writeFile(path.join(tmpDir, 'favicon-32x32.png'), 'small', 'utf-8');
      const indexHtml = await fs.readFile(path.join(tmpDir, 'index.html'), 'utf-8');
      await fs.writeFile(
        path.join(tmpDir, 'index.html'),
        indexHtml.replace(
          '</head>',
          '<link rel="icon" type="image/svg+xml" href="/bad.svg" /><link rel="icon" type="image/png" href="/favicon-48x48.png" sizes="32x32" /><script>fetch("https://api.github.com/users/s0d3s/repos")</script></head>',
        ),
        'utf-8',
      );
      const negIssues = await verifyBuiltDist(tmpDir);
      const codes = negIssues.map((i) => i.code);
      expect(codes).toContain('robots_missing_sitemap');
      expect(codes).toContain('robots_root_disallow');
      expect(codes).toContain('nested_sitemap_index_forbidden');
      expect(codes).toContain('unoptimized_master_favicon_deployed');
      expect(codes).toContain('sub_48px_favicon_forbidden');
      expect(codes).toContain('svg_favicon_forbidden_for_google_seo');
      expect(codes).toContain('favicon_size_below_48px');
      expect(codes).toContain('client_side_api_request_forbidden');
    } finally {
      await fs.rm(tmpDir, { recursive: true, force: true });
    }
  });

  it('retains untouched 1254x1254 master source and exports >=48x48 Google-SEO favicon packs', async () => {
    const masterPath = path.join(REPO_ROOT, 'src', 'assets', 'favicon_1254x1254.png');
    const masterMeta = await sharp(masterPath).metadata();
    expect(masterMeta.width).toBe(1254);
    expect(masterMeta.height).toBe(1254);

    const tmpOut = await fs.mkdtemp(path.join(os.tmpdir(), 's0d3s-favicon-pack-'));
    try {
      const res = await generateFaviconSuite({ sourcePath: masterPath, outDir: tmpOut });
      expect(res.files).toEqual([
        'favicon.ico',
        'favicon-48x48.png',
        'favicon-96x96.png',
        'apple-touch-icon.png',
        'favicon-192x192.png',
        'favicon-512x512.png',
      ]);

      for (const [fname, dim] of [
        ['favicon-48x48.png', 48],
        ['favicon-96x96.png', 96],
        ['apple-touch-icon.png', 180],
        ['favicon-192x192.png', 192],
        ['favicon-512x512.png', 512],
      ] as const) {
        const m = await sharp(path.join(tmpOut, fname)).metadata();
        expect(m.width).toBe(dim);
        expect(m.height).toBe(dim);
        expect(dim).toBeGreaterThanOrEqual(48);
      }

      const icoBuf = await fs.readFile(path.join(tmpOut, 'favicon.ico'));
      expect(icoBuf.readUInt16LE(0)).toBe(0);
      expect(icoBuf.readUInt16LE(2)).toBe(1);
      expect(icoBuf.readUInt16LE(4)).toBe(2);
      const widths = [0, 1].map((idx) => icoBuf.readUInt8(6 + idx * 16));
      expect(widths).toEqual([48, 96]);
    } finally {
      await fs.rm(tmpOut, { recursive: true, force: true });
    }
  });
});

describe('Repository Configuration, Committed Catalog & Dynamic Telemetry Overlay', () => {
  it('validates committed projects-catalog.json, vendored assets, zero-network prepare-assets, and 2-day cron workflow', async () => {
    const configRaw = await fs.readFile(path.join(REPO_ROOT, 'config', 'projects.json'), 'utf-8');
    const config = JSON.parse(configRaw) as ProjectsConfig;
    expect(config.siteOrigin).toBe('https://s0d3s.github.io');
    expect(config.discovery.defaultAdapter).toBe('auto');

    const catalogRaw = await fs.readFile(
      path.join(REPO_ROOT, 'src', 'data', 'projects-catalog.json'),
      'utf-8',
    );
    const catalog = JSON.parse(catalogRaw) as DiscoverySnapshot;
    expect(catalog.hostedPortals.length).toBeGreaterThanOrEqual(2);
    expect(catalog.openSourceProjects.length).toBeGreaterThanOrEqual(4);

    // Ensure prepare-assets.mjs is 100% offline/local (no fetch calls)
    const prepareAssetsSrc = await fs.readFile(
      path.join(REPO_ROOT, 'scripts', 'prepare-assets.mjs'),
      'utf-8',
    );
    expect(prepareAssetsSrc).not.toMatch(/\bfetch\s*\(/);

    // Ensure vendored upstream media files exist locally under src/assets/vendor/
    for (const portal of catalog.hostedPortals) {
      if (portal.vendoredPreviewAsset) {
        const st = await fs.stat(path.join(REPO_ROOT, portal.vendoredPreviewAsset));
        expect(st.size).toBeGreaterThan(1_000);
      }
    }
    for (const proj of catalog.openSourceProjects) {
      if (proj.visual?.vendoredAsset) {
        const st = await fs.stat(path.join(REPO_ROOT, proj.visual.vendoredAsset));
        expect(st.size).toBeGreaterThan(1_000);
      }
    }

    // Verify 2-day unconditional schedule & dynamic-only CI sync in deploy-pages.yml
    const workflowYaml = await fs.readFile(
      path.join(REPO_ROOT, '.github', 'workflows', 'deploy-pages.yml'),
      'utf-8',
    );
    expect(workflowYaml).toContain('cron: "23 4 */2 * *"');
    expect(workflowYaml).toContain('sync-dynamic.mjs --fallback-on-offline');
    expect(workflowYaml).not.toContain('sync-catalog');
    expect(workflowYaml).not.toContain('sync-discovery');
    const expectedDeployIf = [
      'if: $',
      "{{ github.event_name != 'workflow_dispatch' || inputs.deploy_to_pages }}",
    ].join('');
    expect(workflowYaml).toContain(expectedDeployIf);

    const snapshot = loadDiscoverySnapshot();
    for (const portal of snapshot.hostedPortals) {
      expect(portal.docsUrl.startsWith('https://s0d3s.github.io/')).toBe(true);
      expect(portal.repoUrl.startsWith('https://github.com/s0d3s/')).toBe(true);
    }

    const tiers = Object.fromEntries(snapshot.openSourceProjects.map((p) => [p.name, p.tier]));
    expect(tiers.PyAudioWPatch).toBe('main');
    expect(tiers.Positioner).toBe('main');
    expect(tiers.SQLCipherMultiplatform).toBe('secondary');
    expect(tiers.EchoNanny).toBe('utility');

    // Verify lightweight initial posters (< 25 KB AVIF) and deferred animated WebP exist in dist
    const posPoster = await fs.stat(
      path.join(REPO_ROOT, 'dist', 'generated', 'oss', 'positioner-poster.avif'),
    );
    expect(posPoster.size).toBeLessThan(20_000);

    const sqlBanner = await fs.stat(
      path.join(REPO_ROOT, 'dist', 'generated', 'oss', 'sqlciphermultiplatform-640.avif'),
    );
    expect(sqlBanner.size).toBeLessThan(30_000);

    const posAnim = await fs.stat(
      path.join(REPO_ROOT, 'dist', 'generated', 'oss', 'positioner-anim.webp'),
    );
    expect(posAnim.size).toBeGreaterThan(50_000);
  });

  it('merges all build-time dynamic telemetry fields onto committed catalog with clean fallback', async () => {
    const configRaw = await fs.readFile(path.join(REPO_ROOT, 'config', 'projects.json'), 'utf-8');
    const catalogRaw = await fs.readFile(
      path.join(REPO_ROOT, 'src', 'data', 'projects-catalog.json'),
      'utf-8',
    );
    const config = JSON.parse(configRaw) as ProjectsConfig;
    const catalog = JSON.parse(catalogRaw) as DiscoverySnapshot;

    // 1. Offline / null overlay preserves committed catalog baseline cleanly
    const baselineMerged = mergeCatalogWithDynamic(catalog, config, null);
    expect(baselineMerged.generatedAt).toBe(catalog.generatedAt);
    expect(baselineMerged.hostedPortals.length).toBe(catalog.hostedPortals.length);

    // 2. Dynamic overlay updates stars, forks, updatedAt, version, PyPI, and crates.io downloads
    const merged = mergeCatalogWithDynamic(catalog, config, {
      fetchedAt: '2026-11-27T04:23:05.000Z',
      projects: {
        'capture-system-or-process-audio': {
          stars: 42,
          forks: 5,
          updatedAt: '2026-11-27T01:00:00Z',
          version: 'v1.4.0',
          registries: {
            pypi: {
              name: 'capture-system-or-process-audio',
              version: 'v1.4.0',
              url: 'https://pypi.org/project/capture-system-or-process-audio/',
            },
            crates: {
              name: 'capture-system-or-process-audio',
              version: 'v1.4.0',
              url: 'https://crates.io/crates/capture-system-or-process-audio',
              downloadsLabel: '2,500 downloads',
            },
          },
        },
        PyAudioWPatch: {
          stars: 310,
          forks: 39,
          updatedAt: '2026-11-26T18:00:00Z',
          version: 'v0.2.13',
          registries: {
            pypi: {
              name: 'PyAudioWPatch',
              version: 'v0.2.13',
              url: 'https://pypi.org/project/PyAudioWPatch/',
            },
          },
        },
      },
    });

    expect(merged.generatedAt).toBe('2026-11-27T04:23:05.000Z');
    const cspa = merged.hostedPortals.find((p) => p.name === 'capture-system-or-process-audio');
    expect(cspa?.stars).toBe(42);
    expect(cspa?.forks).toBe(5);
    expect(cspa?.version).toBe('v1.4.0');
    expect(cspa?.registries.crates?.downloadsLabel).toBe('2,500 downloads');
    // Committed structural fields remain untouched
    expect(cspa?.leafSitemapUrls).toEqual(
      catalog.hostedPortals.find((p) => p.name === 'capture-system-or-process-audio')
        ?.leafSitemapUrls,
    );

    const pawp = merged.openSourceProjects.find((p) => p.name === 'PyAudioWPatch');
    expect(pawp?.stars).toBe(310);
    expect(pawp?.registries.pypi?.version).toBe('v0.2.13');
    // Unmentioned repos keep committed baseline values
    const pos = merged.openSourceProjects.find((p) => p.name === 'Positioner');
    const basePos = catalog.openSourceProjects.find((p) => p.name === 'Positioner');
    expect(pos?.stars).toBe(basePos?.stars);
    expect(pos?.visual?.vendoredAsset).toBe('src/assets/vendor/oss-positioner.gif');
  });
});
