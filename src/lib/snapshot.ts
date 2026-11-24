import fs from 'node:fs';
import path from 'node:path';
import rawConfig from '../../config/projects.json' with { type: 'json' };
import rawCatalog from '../data/projects-catalog.json' with { type: 'json' };
import { mergeCatalogWithDynamic } from './telemetry.ts';
import type {
  DiscoverySnapshot,
  DynamicTelemetryOverlay,
  FooterPillLink,
  ProjectsConfig,
  TechnicalIndexData,
} from './types.ts';

function readDynamicTelemetryOverlay(): DynamicTelemetryOverlay | null {
  if (process.env.IGNORE_DYNAMIC_TELEMETRY === '1') return null;
  const candidate =
    process.env.DYNAMIC_TELEMETRY_PATH ??
    path.resolve(process.cwd(), '.cache', 'dynamic-telemetry.json');
  try {
    if (!fs.existsSync(candidate)) return null;
    const raw = fs.readFileSync(candidate, 'utf-8');
    return JSON.parse(raw) as DynamicTelemetryOverlay;
  } catch {
    return null;
  }
}

export function loadDiscoverySnapshot(): DiscoverySnapshot {
  const catalog = rawCatalog as unknown as DiscoverySnapshot;
  const config = rawConfig as unknown as ProjectsConfig;
  const dynamic = readDynamicTelemetryOverlay();
  return mergeCatalogWithDynamic(catalog, config, dynamic);
}

const CRATE_SHORT_ORDER = ['capture', 'core', 'windows', 'linux', 'macos'] as const;

function extractRustdocCratePills(snapshot: DiscoverySnapshot): FooterPillLink[] {
  const cspa = snapshot.hostedPortals.find((p) => p.name === 'capture-system-or-process-audio');
  const rustdocMap = cspa?.synthesizedSitemaps.find((sm) => sm.sourceAdapter === 'rustdoc-roots');
  if (!rustdocMap) return [];

  const parsed: FooterPillLink[] = rustdocMap.urls.map((url) => {
    const match = /\/api\/rust\/([^/]+)\/index\.html$/.exec(url);
    const crateName = match?.[1] ?? url;
    const suffix = crateName.replace(/^capture_system_or_process_audio_?/, '');
    const shortName = suffix.length === 0 ? 'capture' : suffix;
    return {
      label: shortName,
      title: `Open cargo doc reference for ${crateName}`,
      url,
      external: true,
    };
  });

  return parsed.sort((a, b) => {
    const ia = CRATE_SHORT_ORDER.indexOf(a.label as (typeof CRATE_SHORT_ORDER)[number]);
    const ib = CRATE_SHORT_ORDER.indexOf(b.label as (typeof CRATE_SHORT_ORDER)[number]);
    const ra = ia === -1 ? 99 : ia;
    const rb = ib === -1 ? 99 : ib;
    return ra !== rb ? ra - rb : a.label.localeCompare(b.label);
  });
}

export function buildTechnicalIndex(snapshot: DiscoverySnapshot): TechnicalIndexData {
  const origin = snapshot.siteOrigin.replace(/\/$/, '');
  const cspa = snapshot.hostedPortals.find((p) => p.name === 'capture-system-or-process-audio');
  const rdi = snapshot.hostedPortals.find((p) => p.name === 'rusty-desktop-icons');
  const pyaudio = snapshot.openSourceProjects.find((p) => p.name === 'PyAudioWPatch');
  const positioner = snapshot.openSourceProjects.find((p) => p.name === 'Positioner');
  const sqlcipher = snapshot.openSourceProjects.find((p) => p.name === 'SQLCipherMultiplatform');

  const cspaDocs = cspa?.docsUrl ?? `${origin}/capture-system-or-process-audio/`;
  const rdiDocs = rdi?.docsUrl ?? `${origin}/rusty-desktop-icons/`;
  const rustdocPills = extractRustdocCratePills(snapshot);

  return {
    matrixRows: [
      {
        workload: 'Cross-platform system, per-app/process & mic audio capture + live PCM mixing',
        substrate: 'Windows WASAPI · Linux PipeWire & PulseAudio · macOS Core Audio Taps & SCK',
        capabilities: ['Python 3.11–3.15t (-Xgil=0)', 'Safe Rust', 'C++17 / C11', '0-Alloc Read'],
        projectName: 'capture-system-or-process-audio',
        primaryUrl: cspaDocs,
        primaryKind: 'docs',
        ...(cspa?.version ? { version: cspa.version } : {}),
      },
      {
        workload: 'Programmable Windows desktop icon automation, motion timelines & GPU shaders',
        substrate: 'Win32 Shell COM · Direct3D 11 Procedural HLSL Shaders',
        capabilities: ['Rust', 'Python', 'Keyframe Curves & Presets'],
        projectName: 'rusty-desktop-icons',
        primaryUrl: rdiDocs,
        primaryKind: 'docs',
        ...(rdi?.version ? { version: rdi.version } : {}),
      },
      {
        workload: 'Legacy Windows-only PortAudio speaker-loopback scripts & drop-in maintenance',
        substrate: 'Windows WASAPI Shared Loopback · PortAudio C Extension',
        capabilities: ['Python C Ext', 'PyAudio API Compatible'],
        projectName: 'PyAudioWPatch',
        primaryUrl: pyaudio?.repoUrl ?? 'https://github.com/s0d3s/PyAudioWPatch',
        primaryKind: 'repo',
        ...(pyaudio?.version ? { version: pyaudio.version } : {}),
      },
      {
        workload:
          'Standalone desktop GUI for multi-monitor icon layout snapshots & 1-click restore',
        substrate: 'Windows 10/11 Native Desktop Application',
        capabilities: ['QML / C++', 'Multi-Monitor Profiles'],
        projectName: 'Positioner',
        primaryUrl: positioner?.repoUrl ?? 'https://github.com/s0d3s/Positioner',
        primaryKind: 'repo',
        ...(positioner?.version ? { version: positioner.version } : {}),
      },
      {
        workload: 'Encrypted SQLite database bindings & JDBC drivers across JVM targets',
        substrate: 'SQLCipher Native C Cryptography · SQLite Engine',
        capabilities: ['Kotlin Multiplatform', 'JVM / JDBC'],
        projectName: 'SQLCipherMultiplatform',
        primaryUrl: sqlcipher?.repoUrl ?? 'https://github.com/s0d3s/SQLCipherMultiplatform',
        primaryKind: 'repo',
        ...(sqlcipher?.version ? { version: sqlcipher.version } : {}),
      },
    ],
    productPanels: [
      {
        projectName: 'capture-system-or-process-audio',
        docsUrl: cspaDocs,
        ...(cspa?.version ? { version: cspa.version } : {}),
        domainBadge: 'Audio Engine · Win / Linux / macOS',
        accent: 'amber',
        span: 'wide',
        tracks: [
          {
            heading: 'Backends, DSP & Lifecycle',
            links: [
              {
                label: 'OS Backend Capability Matrix',
                meta: 'WASAPI · PipeWire · Core Audio',
                url: `${cspaDocs}concepts/platforms/`,
              },
              {
                label: 'Capture Targets & Process Scopes',
                meta: 'tree vs exact · Default-Follow',
                url: `${cspaDocs}concepts/targets-and-scopes/`,
              },
              {
                label: 'CspaMixer & Strategy Waterfall',
                meta: '<10 ms Skew · Drift Slip/Repeat',
                url: `${cspaDocs}concepts/planning-and-mixing/`,
              },
              {
                label: 'Polyphase FIR Resampler & Dither',
                meta: 'Rate, Format & Speaker Mapping',
                url: `${cspaDocs}concepts/format-conversion/`,
              },
              {
                label: 'Zero-Alloc Real-Time Lifecycle',
                meta: 'read_into · SPSC · Live Hot-Swap',
                url: `${cspaDocs}concepts/realtime-and-lifecycle/`,
              },
            ],
          },
          {
            heading: 'SDK Handbooks & ABI References',
            links: [
              {
                label: 'Python 3.11–3.15t (-Xgil=0) SDK',
                meta: 'Free-Threaded abi3t · Migration',
                url: `${cspaDocs}sdks/python/`,
              },
              {
                label: 'Safe Rust Unified Facade',
                meta: 'AudioStream · CaptureManager',
                url: `${cspaDocs}sdks/rust/`,
              },
              {
                label: 'C++17 Header-Only RAII Guide',
                meta: 'Zero-Overhead · /EHs-c- Safe',
                url: `${cspaDocs}sdks/cpp/`,
              },
              {
                label: 'C11 Stable ABI & Struct Layouts',
                meta: 'cspa_experimental.h · CMake',
                url: `${cspaDocs}reference/c/abi-and-functions/`,
              },
              {
                label: 'Recording Permissions & OS Probes',
                meta: 'macOS TCC · Win11 · Flatpak',
                url: `${cspaDocs}concepts/permissions/`,
              },
            ],
          },
        ],
        footerLabel: 'Hosted Rustdoc Crates (/api/rust/)',
        footerPills: rustdocPills,
      },
      {
        projectName: 'rusty-desktop-icons',
        docsUrl: rdiDocs,
        ...(rdi?.version ? { version: rdi.version } : {}),
        domainBadge: 'HLSL & Shell · Win 10/11',
        accent: 'ice',
        span: 'narrow',
        tracks: [
          {
            heading: 'Shell, HLSL Shaders & SDKs',
            links: [
              {
                label: 'Windows Shell & Icon Grid Architecture',
                meta: 'Win32 COM · Multi-Monitor',
                url: `${rdiDocs}concepts/architecture/`,
              },
              {
                label: 'Custom HLSL Procedural Shaders',
                meta: 'D3D11 Render Passes & Effects',
                url: `${rdiDocs}concepts/shaders/custom/`,
              },
              {
                label: 'Keyframe Timelines & Motion Curves',
                meta: 'Easing · Sampled Trajectories',
                url: `${rdiDocs}concepts/timelines/`,
              },
              {
                label: 'Python Shader & Timeline Guides',
                meta: 'Quickstart · Procedural Effects',
                url: `${rdiDocs}python/guides/shaders/`,
              },
              {
                label: 'Rust Crate & Animation Lifecycle',
                meta: 'Render Sessions · Curves',
                url: `${rdiDocs}rust/guides/animation-lifecycle/`,
              },
            ],
          },
        ],
        footerLabel: 'API & Demo',
        footerPills: [
          {
            label: 'Sphinx Python API',
            title: 'Open full Sphinx Python API symbol index',
            url: `${rdiDocs}python/api/rusty_desktop_icons/`,
          },
          {
            label: 'Timeline Demo',
            title: 'Open interactive Timeline Editor demo documentation',
            url: `${rdiDocs}demo-app/`,
          },
        ],
      },
    ],
  };
}
