export type PrimaryAdapterId = 'starlight' | 'sphinx' | 'html-crawl';
export type AdapterChoice = 'auto' | PrimaryAdapterId;
export type ExtraAdapterId = 'rustdoc-roots';

export interface AuthorPillar {
  code: string;
  title: string;
  description: string;
  tags: string[];
}

export interface AuthorThesis {
  valuePrefix: string;
  valueAccent: string;
  label: string;
}

export interface AuthorContactConfig {
  email?: string;
  showEmail?: boolean;
  linkedinUrl?: string;
  showLinkedin?: boolean;
}

export interface AuthorConfig {
  name: string;
  handle: string;
  headlineRole: string;
  tagline: string;
  summary: string;
  rolePills: string[];
  theses?: AuthorThesis[];
  jobTitles: string[];
  knowsAbout: string[];
  pillars: AuthorPillar[];
  githubUrl: string;
  pypiUrl: string;
  cratesIoUrl: string;
  contact: AuthorContactConfig;
}

export type OssTier = 'main' | 'secondary' | 'utility';

export interface OssVisualConfig {
  kind: 'code-stage' | 'animated-demo' | 'banner';
  sourceUrl?: string;
  vendoredAsset?: string;
  alt?: string;
  width?: number;
  height?: number;
  stageTitle?: string;
  stageCode?: string[];
  stageMetrics?: string[];
}

export interface ProjectOverrideConfig {
  adapter?: AdapterChoice;
  extraAdapters?: ExtraAdapterId[];
  rustdocPath?: string;
  rustdocCrates?: string[];
  featuredOrder?: number;
  gridOrder?: number;
  tier?: OssTier;
  bentoSpan?: 'wide' | 'standard';
  visual?: OssVisualConfig;
  kicker?: string;
  successorOf?: string;
  companionTo?: string;
  successorRepo?: string;
  successorNote?: string;
  installCommand?: string;
  altInstallCommand?: string;
  pypiPackage?: string;
  cratesPackage?: string;
  metricBadge?: string;
  platforms?: string[];
  highlights?: string[];
}

export interface ProjectsConfig {
  siteOrigin: string;
  githubOwner: string;
  author: AuthorConfig;
  discovery: {
    defaultAdapter: AdapterChoice;
    excludeRepos: string[];
    excludeForks: boolean;
    excludeArchived: boolean;
    maxOssGridItems: number;
  };
  projectOverrides: Record<string, ProjectOverrideConfig>;
}

export interface DeepLink {
  label: string;
  url: string;
}

export interface SynthesizedSitemap {
  slug: string;
  filename: string;
  project: string;
  sourceAdapter: string;
  urls: string[];
}

export interface ScopedRobotsRule {
  project: string;
  userAgent: string;
  allow: string[];
  disallow: string[];
}

export interface LlmContextBundle {
  llmsTxtUrl?: string;
  llmsFullTxtUrl?: string;
  llmsSmallTxtUrl?: string;
  customSliceUrls: DeepLink[];
  excerpt?: string;
}

export interface RegistryPackageMeta {
  name: string;
  version: string;
  url: string;
  downloadsLabel?: string;
}

export interface RegistryInfo {
  pypi?: RegistryPackageMeta;
  crates?: RegistryPackageMeta;
}

export interface HostedPortal {
  name: string;
  title: string;
  kicker: string;
  description: string;
  docsUrl: string;
  repoUrl: string;
  version?: string;
  primaryLanguage?: string;
  programmingLanguages: string[];
  platforms: string[];
  topics: string[];
  stars: number;
  forks: number;
  updatedAt: string;
  licenses: string[];
  installCommand?: string;
  altInstallCommand?: string;
  highlights: string[];
  deepLinks: DeepLink[];
  previewSourceUrl?: string;
  vendoredPreviewAsset?: string;
  previewSlug: string;
  selectedAdapter: PrimaryAdapterId;
  appliedExtraAdapters: ExtraAdapterId[];
  leafSitemapUrls: string[];
  synthesizedSitemaps: SynthesizedSitemap[];
  scopedRobotsRules: ScopedRobotsRule[];
  llmContext: LlmContextBundle;
  registries: RegistryInfo;
  successorOf?: string;
  companionTo?: string;
}

export interface OpenSourceProject {
  name: string;
  description: string;
  repoUrl: string;
  homepageUrl?: string;
  primaryLanguage?: string;
  topics: string[];
  stars: number;
  forks: number;
  version?: string;
  updatedAt: string;
  installCommand?: string;
  metricBadge?: string;
  tier: OssTier;
  bentoSpan: 'wide' | 'standard';
  mediaSlug: string;
  visual?: OssVisualConfig;
  successorRepo?: string;
  successorDocsUrl?: string;
  successorNote?: string;
  registries: RegistryInfo;
}

export interface WorkloadMatrixRow {
  workload: string;
  substrate: string;
  capabilities: string[];
  projectName: string;
  primaryUrl: string;
  primaryKind: 'docs' | 'repo';
  version?: string;
}

export interface DeepDiveEntry {
  label: string;
  meta: string;
  url: string;
}

export interface DeepDiveTrack {
  heading: string;
  links: DeepDiveEntry[];
}

export interface FooterPillLink {
  label: string;
  title?: string;
  url: string;
  external?: boolean;
}

export interface ProductDeepDivePanel {
  projectName: string;
  docsUrl: string;
  version?: string;
  domainBadge: string;
  accent: 'amber' | 'ice';
  span: 'wide' | 'narrow';
  tracks: DeepDiveTrack[];
  footerLabel: string;
  footerPills: FooterPillLink[];
}

export interface TechnicalIndexData {
  matrixRows: WorkloadMatrixRow[];
  productPanels: ProductDeepDivePanel[];
}

export interface DiscoverySnapshot {
  generatedAt: string;
  siteOrigin: string;
  githubOwner: string;
  author: AuthorConfig;
  hostedPortals: HostedPortal[];
  openSourceProjects: OpenSourceProject[];
  synthesizedSitemaps: SynthesizedSitemap[];
}

export interface DynamicProjectTelemetry {
  stars?: number;
  forks?: number;
  updatedAt?: string;
  version?: string;
  registries?: RegistryInfo;
}

export interface DynamicTelemetryOverlay {
  fetchedAt: string;
  projects: Record<string, DynamicProjectTelemetry>;
}
