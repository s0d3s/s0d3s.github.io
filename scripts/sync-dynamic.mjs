import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const ROOT_DIR = path.resolve(SCRIPT_DIR, '..');
const CONFIG_PATH = path.join(ROOT_DIR, 'config', 'projects.json');
const CATALOG_PATH = path.join(ROOT_DIR, 'src', 'data', 'projects-catalog.json');
const DYNAMIC_OUT_PATH =
  process.env.DYNAMIC_TELEMETRY_PATH ?? path.join(ROOT_DIR, '.cache', 'dynamic-telemetry.json');

const USER_AGENT = 's0d3s-github-io-dynamic-telemetry/1.0 (+https://s0d3s.github.io/)';

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

async function fetchJsonSafe(url, headers = { 'User-Agent': USER_AGENT }) {
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const res = await fetch(url, {
        headers,
        signal: AbortSignal.timeout(10_000),
      });
      if (res.status === 404 || res.status === 403 || res.status === 429) {
        return null;
      }
      if (res.ok) {
        return await res.json();
      }
    } catch {
      // Retry once on transient socket blip
    }
  }
  return null;
}

function normalizeTagVersion(raw) {
  if (!raw) return undefined;
  const trimmed = String(raw).trim();
  if (!trimmed) return undefined;
  return trimmed.startsWith('v') ? trimmed : `v${trimmed}`;
}

async function fetchPypiDynamic(pkgName) {
  const json = await fetchJsonSafe(`https://pypi.org/pypi/${encodeURIComponent(pkgName)}/json`);
  if (!json?.info?.version) return undefined;
  const resolvedName = json.info.name ?? pkgName;
  return {
    name: resolvedName,
    version: normalizeTagVersion(json.info.version),
    url: `https://pypi.org/project/${resolvedName}/`,
  };
}

async function fetchCratesDynamic(crateName) {
  const json = await fetchJsonSafe(
    `https://crates.io/api/v1/crates/${encodeURIComponent(crateName)}`,
  );
  if (!json?.crate?.max_version) return undefined;
  const resolvedId = json.crate.id ?? crateName;
  const downloads = Number(json.crate.downloads ?? 0);
  return {
    name: resolvedId,
    version: normalizeTagVersion(json.crate.max_version),
    url: `https://crates.io/crates/${resolvedId}`,
    ...(downloads >= 100
      ? { downloadsLabel: `${downloads.toLocaleString('en-US')} downloads` }
      : {}),
  };
}

async function fetchLatestGithubReleaseVersion(owner, repoName, ghHeaders) {
  const json = await fetchJsonSafe(
    `https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repoName)}/releases/latest`,
    ghHeaders,
  );
  if (!json || json.draft || json.prerelease || !json.tag_name) return undefined;
  return normalizeTagVersion(json.tag_name);
}

async function main() {
  const fallbackOnOffline = process.argv.includes('--fallback-on-offline');
  const [configRaw, catalogRaw] = await Promise.all([
    fs.readFile(CONFIG_PATH, 'utf-8'),
    fs.readFile(CATALOG_PATH, 'utf-8'),
  ]);
  const config = JSON.parse(configRaw);
  const catalog = JSON.parse(catalogRaw);
  const owner = String(config.githubOwner ?? catalog.githubOwner);
  const ghHeaders = buildGithubHeaders();

  const allCommittedProjects = [
    ...(catalog.hostedPortals ?? []),
    ...(catalog.openSourceProjects ?? []),
  ];

  const reposUrl = `https://api.github.com/users/${encodeURIComponent(owner)}/repos?per_page=100&sort=updated`;
  const reposJson = await fetchJsonSafe(reposUrl, ghHeaders);

  if (!Array.isArray(reposJson) && !fallbackOnOffline) {
    throw new Error(`Failed to fetch dynamic GitHub repository metrics from ${reposUrl}`);
  }

  const repoByName = new Map();
  if (Array.isArray(reposJson)) {
    for (const r of reposJson) {
      if (r && typeof r.name === 'string') {
        repoByName.set(r.name.toLowerCase(), r);
      }
    }
  }

  const dynamicProjects = {};
  let updatedCount = 0;

  await Promise.all(
    allCommittedProjects.map(async (proj) => {
      const name = proj.name;
      const override = config.projectOverrides?.[name];
      const ghRepo = repoByName.get(name.toLowerCase());

      const pypiPkg = override?.pypiPackage ?? proj.registries?.pypi?.name;
      const cratesPkg = override?.cratesPackage ?? proj.registries?.crates?.name;

      const [pypiDyn, cratesDyn, ghReleaseVer] = await Promise.all([
        pypiPkg ? fetchPypiDynamic(pypiPkg) : Promise.resolve(undefined),
        cratesPkg ? fetchCratesDynamic(cratesPkg) : Promise.resolve(undefined),
        !pypiPkg && !cratesPkg && Array.isArray(reposJson)
          ? fetchLatestGithubReleaseVersion(owner, name, ghHeaders)
          : Promise.resolve(undefined),
      ]);

      const entry = {};
      if (ghRepo) {
        entry.stars = Number(ghRepo.stargazers_count ?? proj.stars ?? 0);
        entry.forks = Number(ghRepo.forks_count ?? proj.forks ?? 0);
        if (ghRepo.updated_at) entry.updatedAt = String(ghRepo.updated_at);
      }

      const registries = {};
      if (pypiDyn) registries.pypi = pypiDyn;
      if (cratesDyn) registries.crates = cratesDyn;
      if (Object.keys(registries).length > 0) {
        entry.registries = registries;
      }

      const resolvedVersion = pypiDyn?.version ?? cratesDyn?.version ?? ghReleaseVer;
      if (resolvedVersion) {
        entry.version = resolvedVersion;
      }

      if (Object.keys(entry).length > 0) {
        dynamicProjects[name] = entry;
        updatedCount++;
      }
    }),
  );

  if (updatedCount === 0 && fallbackOnOffline) {
    console.log(
      '[sync-dynamic] Network/API unavailable; retaining committed catalog baseline metrics.',
    );
    return;
  }

  const payload = {
    fetchedAt: new Date().toISOString(),
    projects: dynamicProjects,
  };

  await fs.mkdir(path.dirname(DYNAMIC_OUT_PATH), { recursive: true });
  await fs.writeFile(DYNAMIC_OUT_PATH, `${JSON.stringify(payload, null, 2)}\n`, 'utf-8');

  console.log(
    `[sync-dynamic] Refreshed dynamic telemetry (stars, forks, updatedAt, release versions & downloads) for ${updatedCount}/${allCommittedProjects.length} committed projects.`,
  );
}

main().catch((err) => {
  console.error('[sync-dynamic] ERROR:', err);
  process.exit(1);
});
