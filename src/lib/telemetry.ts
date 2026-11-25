import type {
  DiscoverySnapshot,
  DynamicTelemetryOverlay,
  HostedPortal,
  OpenSourceProject,
  ProjectOverrideConfig,
  ProjectsConfig,
  RegistryInfo,
} from './types.ts';

function mergeRegistries(base: RegistryInfo, dyn?: RegistryInfo): RegistryInfo {
  if (!dyn) return { ...base };
  return {
    ...(base.pypi || dyn.pypi
      ? {
          pypi: {
            ...(base.pypi ?? {}),
            ...(dyn.pypi ?? {}),
          } as NonNullable<RegistryInfo['pypi']>,
        }
      : {}),
    ...(base.crates || dyn.crates
      ? {
          crates: {
            ...(base.crates ?? {}),
            ...(dyn.crates ?? {}),
          } as NonNullable<RegistryInfo['crates']>,
        }
      : {}),
  };
}

export function dedupeLabels(items: readonly string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of items) {
    const trimmed = raw.trim();
    if (!trimmed) continue;
    const key = trimmed.toLowerCase();
    if (!seen.has(key)) {
      seen.add(key);
      out.push(trimmed);
    }
  }
  return out;
}

function applyPortalConfigAndTelemetry(
  portal: HostedPortal,
  override: ProjectOverrideConfig | undefined,
  dyn: DynamicTelemetryOverlay['projects'][string] | undefined,
): HostedPortal {
  const registries = mergeRegistries(portal.registries, dyn?.registries);
  const version =
    dyn?.version ?? registries.pypi?.version ?? registries.crates?.version ?? portal.version;

  const programmingLanguages = dedupeLabels(portal.programmingLanguages);
  const langKeys = new Set(programmingLanguages.map((l) => l.toLowerCase()));
  const rawPlatforms = dedupeLabels(override?.platforms ?? portal.platforms);
  const platforms = rawPlatforms.filter((plat) => !langKeys.has(plat.toLowerCase()));

  return {
    ...portal,
    ...(override?.kicker ? { kicker: override.kicker } : {}),
    platforms,
    programmingLanguages,
    ...(override?.highlights ? { highlights: override.highlights } : {}),
    ...(override?.installCommand ? { installCommand: override.installCommand } : {}),
    ...(override?.altInstallCommand ? { altInstallCommand: override.altInstallCommand } : {}),
    ...(override?.successorOf ? { successorOf: override.successorOf } : {}),
    ...(override?.companionTo ? { companionTo: override.companionTo } : {}),
    ...(typeof dyn?.stars === 'number' ? { stars: dyn.stars } : {}),
    ...(typeof dyn?.forks === 'number' ? { forks: dyn.forks } : {}),
    ...(dyn?.updatedAt ? { updatedAt: dyn.updatedAt } : {}),
    ...(version ? { version } : {}),
    registries,
  };
}

function applyOssConfigAndTelemetry(
  project: OpenSourceProject,
  override: ProjectOverrideConfig | undefined,
  dyn: DynamicTelemetryOverlay['projects'][string] | undefined,
  siteOrigin: string,
): OpenSourceProject {
  const registries = mergeRegistries(project.registries, dyn?.registries);
  const version =
    dyn?.version ?? registries.pypi?.version ?? registries.crates?.version ?? project.version;

  const mergedVisual = override?.visual
    ? {
        ...override.visual,
        ...(project.visual?.vendoredAsset && !override.visual.vendoredAsset
          ? { vendoredAsset: project.visual.vendoredAsset }
          : {}),
      }
    : project.visual;

  return {
    ...project,
    ...(override?.installCommand ? { installCommand: override.installCommand } : {}),
    ...(override?.metricBadge ? { metricBadge: override.metricBadge } : {}),
    ...(override?.tier ? { tier: override.tier } : {}),
    ...(override?.bentoSpan ? { bentoSpan: override.bentoSpan } : {}),
    ...(mergedVisual ? { visual: mergedVisual } : {}),
    ...(override?.successorRepo
      ? {
          successorRepo: override.successorRepo,
          successorDocsUrl: `${siteOrigin}/${override.successorRepo}/`,
        }
      : {}),
    ...(override?.successorNote ? { successorNote: override.successorNote } : {}),
    ...(typeof dyn?.stars === 'number' ? { stars: dyn.stars } : {}),
    ...(typeof dyn?.forks === 'number' ? { forks: dyn.forks } : {}),
    ...(dyn?.updatedAt ? { updatedAt: dyn.updatedAt } : {}),
    ...(version ? { version } : {}),
    registries,
  };
}

export function mergeCatalogWithDynamic(
  catalog: DiscoverySnapshot,
  config?: ProjectsConfig,
  dynamic?: DynamicTelemetryOverlay | null,
): DiscoverySnapshot {
  const siteOrigin = (config?.siteOrigin ?? catalog.siteOrigin).replace(/\/$/, '');
  const excludedSet = new Set((config?.discovery?.excludeRepos ?? []).map((n) => n.toLowerCase()));

  const hostedPortals = catalog.hostedPortals
    .filter((p) => !excludedSet.has(p.name.toLowerCase()))
    .map((p) =>
      applyPortalConfigAndTelemetry(
        p,
        config?.projectOverrides?.[p.name],
        dynamic?.projects?.[p.name],
      ),
    )
    .sort((a, b) => {
      const orderA = config?.projectOverrides?.[a.name]?.featuredOrder ?? 999;
      const orderB = config?.projectOverrides?.[b.name]?.featuredOrder ?? 999;
      if (orderA !== orderB) return orderA - orderB;
      if (b.stars !== a.stars) return b.stars - a.stars;
      return b.updatedAt.localeCompare(a.updatedAt);
    });

  const openSourceProjects = catalog.openSourceProjects
    .filter((p) => !excludedSet.has(p.name.toLowerCase()))
    .map((p) =>
      applyOssConfigAndTelemetry(
        p,
        config?.projectOverrides?.[p.name],
        dynamic?.projects?.[p.name],
        siteOrigin,
      ),
    )
    .sort((a, b) => {
      const orderA = config?.projectOverrides?.[a.name]?.gridOrder ?? 999;
      const orderB = config?.projectOverrides?.[b.name]?.gridOrder ?? 999;
      if (orderA !== orderB) return orderA - orderB;
      if (b.stars !== a.stars) return b.stars - a.stars;
      return b.updatedAt.localeCompare(a.updatedAt);
    });

  const activePortalNames = new Set(hostedPortals.map((p) => p.name));
  const synthesizedSitemaps = catalog.synthesizedSitemaps.filter((s) =>
    activePortalNames.has(s.project),
  );

  return {
    generatedAt: dynamic?.fetchedAt ?? catalog.generatedAt,
    siteOrigin,
    githubOwner: config?.githubOwner ?? catalog.githubOwner,
    author: config?.author ?? catalog.author,
    hostedPortals,
    openSourceProjects,
    synthesizedSitemaps,
  };
}
