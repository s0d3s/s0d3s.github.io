import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { runProjectSiteAdapters } from '../src/lib/adapters.ts';
import { extractReadmeMetadata, parseHtmlDocument, stripHtmlTags } from '../src/lib/parsers.ts';

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const ROOT_DIR = path.resolve(SCRIPT_DIR, '..');
const CONFIG_PATH = path.join(ROOT_DIR, 'config', 'projects.json');
const CATALOG_PATH = path.join(ROOT_DIR, 'src', 'data', 'projects-catalog.json');
const VENDOR_DIR = path.join(ROOT_DIR, 'src', 'assets', 'vendor');

const USER_AGENT = 's0d3s-github-io-catalog-sync/1.0 (+https://s0d3s.github.io/)';

function buildGithubHeaders() {
  const headers = {
    Accept: 'application/vnd.github+json',
    'User-Agent': USER_AGENT,
  };
  if (process.env.GITHUB_TOKEN) {
    headers.Authorization = `Bearer ${process.env.GITHUB_TOKEN}`;
  }
  return headers;
}

function createCachedHttpTextFetcher() {
  const cache = new Map();
  return async function fetchText(url) {
    const cached = cache.get(url);
    if (cached) return cached;

    const promise = (async () => {
      for (let attempt = 0; attempt < 2; attempt++) {
        try {
          const res = await fetch(url, {
            headers: { 'User-Agent': USER_AGENT },
            signal: AbortSignal.timeout(15_000),
          });
          const contentType = res.headers.get('content-type') ?? '';
          const body = res.ok ? await res.text() : '';
          if (res.ok || res.status === 404) {
            return { ok: res.ok, status: res.status, contentType, body };
          }
        } catch {
          // Retry once on transient network timeout
        }
      }
      return { ok: false, status: 0, contentType: '', body: '' };
    })();

    cache.set(url, promise);
    return promise;
  };
}

async function fetchJsonSafe(url, headers = { 'User-Agent': USER_AGENT }) {
  try {
    const res = await fetch(url, {
      headers,
      signal: AbortSignal.timeout(12_000),
    });
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}

async function vendorRemoteAsset(url, basenamePrefix) {
  await fs.mkdir(VENDOR_DIR, { recursive: true });
  const ext = path.extname(new URL(url).pathname) || '.bin';
  const filename = `${basenamePrefix}${ext}`;
  const destPath = path.join(VENDOR_DIR, filename);
  const relPath = `src/assets/vendor/${filename}`;

  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const res = await fetch(url, {
        headers: { 'User-Agent': USER_AGENT },
        signal: AbortSignal.timeout(20_000),
      });
      if (res.ok) {
        const buf = Buffer.from(await res.arrayBuffer());
        await fs.writeFile(destPath, buf);
        return relPath;
      }
    } catch {
      // Retry once, then fall back to existing vendored file if present
    }
  }

  try {
    await fs.access(destPath);
    return relPath;
  } catch {
    return undefined;
  }
}

function sanitizeDescription(raw) {
  if (!raw) return '';
  return raw
    .replace(
      /([a-zA-Z0-9)])\s*(?:[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]|\uFE0F)+\s*([A-Z])/gu,
      '$1 · $2',
    )
    .replace(/(?:[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]|\uFE0F)/gu, '')
    .replace(/\s*\|\s*/g, ' — ')
    .replace(/\s+/g, ' ')
    .trim();
}

async function probeRegistries(repoName, override) {
  const pypiCandidate = override?.pypiPackage ?? repoName;
  const cratesCandidate = override?.cratesPackage ?? repoName;

  const [pypiJson, cratesJson] = await Promise.all([
    fetchJsonSafe(`https://pypi.org/pypi/${encodeURIComponent(pypiCandidate)}/json`),
    fetchJsonSafe(`https://crates.io/api/v1/crates/${encodeURIComponent(cratesCandidate)}`),
  ]);

  const registries = {};
  const expectedOwnerUrl = 'github.com/s0d3s';

  if (pypiJson?.info?.version) {
    const urlsText =
      JSON.stringify(pypiJson.info.project_urls ?? {}) + (pypiJson.info.home_page ?? '');
    if (override?.pypiPackage || urlsText.toLowerCase().includes(expectedOwnerUrl)) {
      registries.pypi = {
        name: pypiJson.info.name ?? pypiCandidate,
        version: `v${String(pypiJson.info.version).replace(/^v/, '')}`,
        url: `https://pypi.org/project/${pypiJson.info.name ?? pypiCandidate}/`,
      };
    }
  }

  if (cratesJson?.crate?.max_version) {
    const repoField = String(cratesJson.crate.repository ?? '').toLowerCase();
    if (override?.cratesPackage || repoField.includes(expectedOwnerUrl)) {
      const downloads = Number(cratesJson.crate.downloads ?? 0);
      registries.crates = {
        name: cratesJson.crate.id ?? cratesCandidate,
        version: `v${String(cratesJson.crate.max_version).replace(/^v/, '')}`,
        url: `https://crates.io/crates/${cratesJson.crate.id ?? cratesCandidate}`,
        ...(downloads >= 100
          ? { downloadsLabel: `${downloads.toLocaleString('en-US')} downloads` }
          : {}),
      };
    }
  }

  return registries;
}

function extractLanguagesAndLicensesFromJsonLd(jsonLdObjects, fallbackLang) {
  const langs = new Set();
  const licenses = new Set();
  for (const node of jsonLdObjects) {
    const pl = node.programmingLanguage;
    if (typeof pl === 'string') langs.add(pl);
    else if (Array.isArray(pl)) {
      for (const item of pl) if (typeof item === 'string') langs.add(item);
    }
    const lic = node.license;
    if (typeof lic === 'string') licenses.add(lic);
    else if (Array.isArray(lic)) {
      for (const item of lic) if (typeof item === 'string') licenses.add(item);
    }
  }
  if (langs.size === 0 && fallbackLang) langs.add(fallbackLang);
  return {
    programmingLanguages: [...langs],
    licenses:
      licenses.size > 0
        ? [...licenses]
        : ['https://opensource.org/licenses/MIT', 'https://www.apache.org/licenses/LICENSE-2.0'],
  };
}

async function main() {
  const configRaw = await fs.readFile(CONFIG_PATH, 'utf-8');
  const config = JSON.parse(configRaw);
  const siteOrigin = String(config.siteOrigin).replace(/\/$/, '');
  const owner = String(config.githubOwner);
  const excludedSet = new Set(
    (config.discovery.excludeRepos ?? []).map((name) => String(name).toLowerCase()),
  );

  const reposUrl = `https://api.github.com/users/${encodeURIComponent(owner)}/repos?per_page=100&sort=updated`;
  const repos = await fetchJsonSafe(reposUrl, buildGithubHeaders());
  if (!Array.isArray(repos)) {
    throw new Error(`Failed to fetch public repositories from ${reposUrl}`);
  }

  const fetchText = createCachedHttpTextFetcher();
  const hostedPortals = [];
  const openSourceProjects = [];
  let vendoredCount = 0;

  const eligibleRepos = repos.filter((repo) => {
    if (!repo || typeof repo.name !== 'string') return false;
    if (excludedSet.has(repo.name.toLowerCase())) return false;
    if (config.discovery.excludeForks && repo.fork) return false;
    if (config.discovery.excludeArchived && repo.archived) return false;
    return true;
  });

  for (const repo of eligibleRepos) {
    const name = repo.name;
    const override = config.projectOverrides?.[name];
    const defaultBranch = repo.default_branch || 'main';
    const rawReadmeUrl = `https://raw.githubusercontent.com/${owner}/${name}/${defaultBranch}/README.md`;

    const [readmeRes, registries] = await Promise.all([
      fetchText(rawReadmeUrl),
      probeRegistries(name, override),
    ]);

    const readmeMeta = readmeRes.ok ? extractReadmeMetadata(readmeRes.body, name) : {};
    const portalUrl = `${siteOrigin}/${name}/`;
    const portalRes = repo.has_pages
      ? await fetchText(portalUrl)
      : { ok: false, status: 404, contentType: '', body: '' };

    if (repo.has_pages && portalRes.ok && portalRes.contentType.includes('text/html')) {
      const parsedRoot = parseHtmlDocument(portalRes.body, portalUrl);
      const adapterOut = await runProjectSiteAdapters(
        {
          repoName: name,
          portalUrl,
          rootHtml: portalRes.body,
          parsedRoot,
          override,
          fetchText,
        },
        config.discovery.defaultAdapter ?? 'auto',
      );

      const { programmingLanguages, licenses } = extractLanguagesAndLicensesFromJsonLd(
        parsedRoot.jsonLdObjects,
        repo.language,
      );

      let version = registries.pypi?.version ?? registries.crates?.version;
      if (!version) {
        const titleVer = parsedRoot.title.match(/\bv?(\d+\.\d+\.\d+(?:-[a-zA-Z0-9.]+)?)\b/);
        if (titleVer?.[1]) version = `v${titleVer[1]}`;
      }

      const description =
        parsedRoot.description ||
        parsedRoot.ogDescription ||
        sanitizeDescription(repo.description) ||
        parsedRoot.firstParagraph;

      const topics = Array.isArray(repo.topics) ? repo.topics : [];
      if (programmingLanguages.length <= 1) {
        if (topics.includes('python') && !programmingLanguages.includes('Python')) {
          programmingLanguages.push('Python');
        }
        if (topics.includes('rust') && !programmingLanguages.includes('Rust')) {
          programmingLanguages.unshift('Rust');
        }
        if (topics.includes('cpp') && !programmingLanguages.includes('C++')) {
          programmingLanguages.push('C++');
        }
      }

      const previewSlug = name.toLowerCase().replace(/[^a-z0-9-]+/g, '-');
      const previewSourceUrl =
        parsedRoot.ogImage && /\.(png|jpe?g|webp|avif)$/i.test(parsedRoot.ogImage)
          ? parsedRoot.ogImage
          : undefined;

      const vendoredPreviewAsset = previewSourceUrl
        ? await vendorRemoteAsset(previewSourceUrl, `portal-${previewSlug}`)
        : undefined;
      if (vendoredPreviewAsset) vendoredCount++;

      hostedPortals.push({
        name,
        title: stripHtmlTags(parsedRoot.ogTitle || parsedRoot.title || name),
        kicker: override?.kicker ?? 'Hosted Documentation Portal',
        description,
        docsUrl: portalUrl,
        repoUrl: repo.html_url,
        ...(version ? { version } : {}),
        ...(repo.language ? { primaryLanguage: repo.language } : {}),
        programmingLanguages,
        platforms: (
          override?.platforms ??
          (topics.includes('cross-platform')
            ? ['Windows', 'Linux', 'macOS']
            : topics.includes('windows')
              ? ['Windows']
              : [])
        ).filter(
          (plat, idx, arr) =>
            arr.findIndex((x) => x.toLowerCase() === plat.toLowerCase()) === idx &&
            !programmingLanguages.some((l) => l.toLowerCase() === plat.toLowerCase()),
        ),
        topics,
        stars: Number(repo.stargazers_count ?? 0),
        forks: Number(repo.forks_count ?? 0),
        updatedAt: repo.updated_at ?? new Date().toISOString(),
        licenses,
        installCommand: override?.installCommand ?? readmeMeta.installCommand,
        altInstallCommand: override?.altInstallCommand ?? readmeMeta.altInstallCommand,
        highlights:
          override?.highlights ?? (parsedRoot.firstParagraph ? [parsedRoot.firstParagraph] : []),
        deepLinks: adapterOut.deepLinks,
        ...(previewSourceUrl ? { previewSourceUrl } : {}),
        ...(vendoredPreviewAsset ? { vendoredPreviewAsset } : {}),
        previewSlug,
        selectedAdapter: adapterOut.selectedAdapter,
        appliedExtraAdapters: adapterOut.appliedExtraAdapters,
        leafSitemapUrls: adapterOut.leafSitemapUrls,
        synthesizedSitemaps: adapterOut.synthesizedSitemaps,
        scopedRobotsRules: adapterOut.scopedRobotsRules,
        llmContext: adapterOut.llmContext,
        registries,
        ...(override?.successorOf ? { successorOf: override.successorOf } : {}),
        ...(override?.companionTo ? { companionTo: override.companionTo } : {}),
        _order: override?.featuredOrder ?? 999,
      });
    } else {
      const version = registries.pypi?.version ?? registries.crates?.version;
      const description =
        sanitizeDescription(repo.description) ||
        `${name} open-source ${repo.language ?? 'software'} repository by @${owner}.`;

      const mediaSlug = name.toLowerCase().replace(/[^a-z0-9-]+/g, '-');
      let visual = override?.visual ? { ...override.visual } : undefined;
      if (visual?.sourceUrl) {
        const vendoredAsset = await vendorRemoteAsset(visual.sourceUrl, `oss-${mediaSlug}`);
        if (vendoredAsset) {
          visual = { ...visual, vendoredAsset };
          vendoredCount++;
        }
      }

      openSourceProjects.push({
        name,
        description,
        repoUrl: repo.html_url,
        ...(repo.homepage ? { homepageUrl: repo.homepage } : {}),
        ...(repo.language ? { primaryLanguage: repo.language } : {}),
        topics: Array.isArray(repo.topics) ? repo.topics : [],
        stars: Number(repo.stargazers_count ?? 0),
        forks: Number(repo.forks_count ?? 0),
        ...(version ? { version } : {}),
        updatedAt: repo.updated_at ?? new Date().toISOString(),
        ...((override?.installCommand ?? readmeMeta.installCommand)
          ? { installCommand: override?.installCommand ?? readmeMeta.installCommand }
          : {}),
        ...(override?.metricBadge ? { metricBadge: override.metricBadge } : {}),
        tier: override?.tier ?? 'utility',
        bentoSpan: override?.bentoSpan ?? 'standard',
        mediaSlug,
        ...(visual ? { visual } : {}),
        ...(override?.successorRepo
          ? {
              successorRepo: override.successorRepo,
              successorDocsUrl: `${siteOrigin}/${override.successorRepo}/`,
            }
          : {}),
        ...(override?.successorNote ? { successorNote: override.successorNote } : {}),
        registries,
        _order: override?.gridOrder ?? 999,
      });
    }
  }

  hostedPortals.sort((a, b) => {
    if (a._order !== b._order) return a._order - b._order;
    if (b.stars !== a.stars) return b.stars - a.stars;
    return b.updatedAt.localeCompare(a.updatedAt);
  });

  openSourceProjects.sort((a, b) => {
    if (a._order !== b._order) return a._order - b._order;
    if (b.stars !== a.stars) return b.stars - a.stars;
    return b.updatedAt.localeCompare(a.updatedAt);
  });

  const maxOss = Number(config.discovery.maxOssGridItems ?? 8);
  const cleanPortals = hostedPortals.map(({ _order, ...rest }) => rest);
  const cleanOss = openSourceProjects.slice(0, maxOss).map(({ _order, ...rest }) => rest);
  const synthesizedSitemaps = cleanPortals.flatMap((p) => p.synthesizedSitemaps);

  const catalog = {
    generatedAt: new Date().toISOString(),
    siteOrigin,
    githubOwner: owner,
    author: config.author,
    hostedPortals: cleanPortals,
    openSourceProjects: cleanOss,
    synthesizedSitemaps,
  };

  await fs.mkdir(path.dirname(CATALOG_PATH), { recursive: true });
  await fs.writeFile(CATALOG_PATH, `${JSON.stringify(catalog, null, 2)}\n`, 'utf-8');

  console.log(
    `[sync-catalog] Synced ${cleanPortals.length} hosted portals, ${cleanOss.length} OSS projects, ${synthesizedSitemaps.length} synthesized sitemaps, and ${vendoredCount} vendored media assets into ${CATALOG_PATH}.`,
  );
}

main().catch((err) => {
  console.error('[sync-catalog] ERROR:', err);
  process.exit(1);
});
