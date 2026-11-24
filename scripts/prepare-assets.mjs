import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';
import { DEFAULT_FAVICON_SOURCE, generateFaviconSuite } from '../src/lib/favicons.ts';
import { loadDiscoverySnapshot } from '../src/lib/snapshot.ts';

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const ROOT_DIR = path.resolve(SCRIPT_DIR, '..');
const GENERATED_DIR = path.join(ROOT_DIR, 'public', 'generated');
const PREVIEWS_DIR = path.join(GENERATED_DIR, 'previews');
const OSS_MEDIA_DIR = path.join(GENERATED_DIR, 'oss');
const OG_CARD_PATH = path.join(ROOT_DIR, 'public', 'og-card-1280x640.png');

function escapeSvg(text) {
  return String(text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function buildDomainOgSvg(snapshot) {
  const portalNames = snapshot.hostedPortals.map((p) => p.name).slice(0, 2);
  return `<svg xmlns="http://www.w3.org/2000/svg" width="1280" height="640" viewBox="0 0 1280 640">
  <defs>
    <radialGradient id="amberGlow" cx="78%" cy="18%" r="58%">
      <stop offset="0%" stop-color="#F59E0B" stop-opacity="0.24" />
      <stop offset="52%" stop-color="#F43F5E" stop-opacity="0.07" />
      <stop offset="100%" stop-color="#050507" stop-opacity="0" />
    </radialGradient>
    <linearGradient id="rim" x1="0" y1="0" x2="1280" y2="0" gradientUnits="userSpaceOnUse">
      <stop offset="0%" stop-color="#050507" />
      <stop offset="30%" stop-color="#F8FAFC" stop-opacity="0.32" />
      <stop offset="62%" stop-color="#F59E0B" stop-opacity="0.72" />
      <stop offset="100%" stop-color="#050507" />
    </linearGradient>
    <pattern id="grid" width="40" height="40" patternUnits="userSpaceOnUse">
      <path d="M 40 0 L 0 0 0 40" fill="none" stroke="#FFFFFF" stroke-opacity="0.035" stroke-width="1" />
    </pattern>
  </defs>
  <rect width="1280" height="640" fill="#050507" />
  <rect width="1280" height="640" fill="url(#grid)" />
  <rect width="1280" height="640" fill="url(#amberGlow)" />
  <rect x="56" y="52" width="1168" height="536" rx="24" fill="#0A0B0F" fill-opacity="0.92" stroke="#22232B" stroke-width="1.5" />
  <path d="M 96 52.75 L 1184 52.75" stroke="url(#rim)" stroke-width="2" />

  <rect x="104" y="102" width="248" height="34" rx="17" fill="#17130D" stroke="#F59E0B" stroke-opacity="0.45" />
  <circle cx="124" cy="119" r="5" fill="#F59E0B" />
  <text x="140" y="124" fill="#FDE68A" font-family="Consolas, 'Courier New', monospace" font-size="14" font-weight="700" letter-spacing="1.2">S0D3S.GITHUB.IO HUB</text>

  <text x="104" y="210" fill="#F8FAFC" font-family="Segoe UI, system-ui, sans-serif" font-size="56" font-weight="800" letter-spacing="-1.5">SoDeS (@s0d3s)</text>
  <text x="104" y="262" fill="#F59E0B" font-family="Segoe UI, system-ui, sans-serif" font-size="24" font-weight="600">Systems &amp; Trading Platform Architect · Native OSS</text>
  <text x="104" y="302" fill="#A1A1AA" font-family="Segoe UI, system-ui, sans-serif" font-size="18">Engineering Team Lead · DevOps Architect · Quant Data Scientist</text>
  <text x="104" y="340" fill="#71717A" font-family="Consolas, 'Courier New', monospace" font-size="14">140k+ Installs · Zero-Overhead Arch · Rust · C++ · Python · Full-Stack Web</text>
  <rect x="944" y="96" width="228" height="228" rx="28" fill="#0D0E14" stroke="#F59E0B" stroke-opacity="0.5" stroke-width="2" />

  <g transform="translate(104, 386)">
    <rect x="0" y="0" width="516" height="136" rx="16" fill="#0F1117" stroke="#2A2C37" />
    <text x="26" y="38" fill="#F59E0B" font-family="Consolas, monospace" font-size="13" font-weight="700" letter-spacing="1">PORTAL 01 // AUDIO ENGINE</text>
    <text x="26" y="74" fill="#F8FAFC" font-family="Segoe UI, system-ui, sans-serif" font-size="22" font-weight="700">${escapeSvg(portalNames[0] ?? 'capture-system-or-process-audio')}</text>
    <text x="26" y="108" fill="#94A3B8" font-family="Consolas, monospace" font-size="15">WASAPI · PipeWire · PulseAudio · Core Audio · SCK</text>
  </g>

  <g transform="translate(652, 386)">
    <rect x="0" y="0" width="520" height="136" rx="16" fill="#0F1117" stroke="#2A2C37" />
    <text x="26" y="38" fill="#FBBF24" font-family="Consolas, monospace" font-size="13" font-weight="700" letter-spacing="1">PORTAL 02 // GPU DESKTOP ENGINE</text>
    <text x="26" y="74" fill="#F8FAFC" font-family="Segoe UI, system-ui, sans-serif" font-size="22" font-weight="700">${escapeSvg(portalNames[1] ?? 'rusty-desktop-icons')}</text>
    <text x="26" y="108" fill="#94A3B8" font-family="Consolas, monospace" font-size="15">Windows Shell · HLSL Shaders · Rust &amp; Python</text>
  </g>
</svg>`;
}

function buildSynthesizedPortalPreviewSvg(portal) {
  const langs = (portal.programmingLanguages ?? []).slice(0, 4).join('  ·  ') || 'Rust  ·  Python';
  const install = portal.installCommand || `git clone ${portal.repoUrl}`;
  const ver = portal.version || 'latest';
  return `<svg xmlns="http://www.w3.org/2000/svg" width="1280" height="640" viewBox="0 0 1280 640">
  <defs>
    <radialGradient id="glow" cx="72%" cy="28%" r="60%">
      <stop offset="0%" stop-color="#F59E0B" stop-opacity="0.28" />
      <stop offset="55%" stop-color="#F43F5E" stop-opacity="0.09" />
      <stop offset="100%" stop-color="#050507" stop-opacity="0" />
    </radialGradient>
    <linearGradient id="spec" x1="80" y1="0" x2="1200" y2="0" gradientUnits="userSpaceOnUse">
      <stop offset="0%" stop-color="#F8FAFC" stop-opacity="0.05" />
      <stop offset="45%" stop-color="#F59E0B" stop-opacity="0.75" />
      <stop offset="100%" stop-color="#F8FAFC" stop-opacity="0.05" />
    </linearGradient>
    <pattern id="dots" width="32" height="32" patternUnits="userSpaceOnUse">
      <circle cx="2" cy="2" r="1.2" fill="#F8FAFC" fill-opacity="0.08" />
    </pattern>
  </defs>
  <rect width="1280" height="640" fill="#06070A" />
  <rect width="1280" height="640" fill="url(#dots)" />
  <rect width="1280" height="640" fill="url(#glow)" />

  <!-- Decorative procedural GPU icon grid -->
  <g transform="translate(810, 118)" opacity="0.92">
    <rect x="0" y="0" width="360" height="360" rx="26" fill="#0C0E14" stroke="#262834" stroke-width="1.5" />
    <rect x="34" y="34" width="82" height="82" rx="18" fill="#16130E" stroke="#F59E0B" stroke-width="2" />
    <rect x="139" y="34" width="82" height="82" rx="18" fill="#11131B" stroke="#3F3F46" stroke-width="1.5" />
    <rect x="244" y="34" width="82" height="82" rx="18" fill="#11131B" stroke="#3F3F46" stroke-width="1.5" />
    <rect x="34" y="139" width="82" height="82" rx="18" fill="#11131B" stroke="#3F3F46" stroke-width="1.5" />
    <rect x="139" y="139" width="82" height="82" rx="18" fill="#1D150C" stroke="#FBBF24" stroke-width="2.2" />
    <rect x="244" y="139" width="82" height="82" rx="18" fill="#181116" stroke="#F43F5E" stroke-opacity="0.65" stroke-width="1.8" />
    <rect x="34" y="244" width="82" height="82" rx="18" fill="#11131B" stroke="#3F3F46" stroke-width="1.5" />
    <rect x="139" y="244" width="82" height="82" rx="18" fill="#11131B" stroke="#3F3F46" stroke-width="1.5" />
    <rect x="244" y="244" width="82" height="82" rx="18" fill="#16130E" stroke="#F59E0B" stroke-width="2" />
    <path d="M 75 75 Q 180 110 180 180 T 285 285" fill="none" stroke="#F59E0B" stroke-width="3" stroke-dasharray="6 6" />
  </g>

  <path d="M 72 64 L 1208 64" stroke="url(#spec)" stroke-width="2" />

  <rect x="76" y="114" width="136" height="36" rx="18" fill="#1A140B" stroke="#F59E0B" stroke-opacity="0.55" />
  <text x="144" y="138" text-anchor="middle" fill="#FDE68A" font-family="Consolas, monospace" font-size="16" font-weight="700">${escapeSvg(ver)}</text>

  <text x="230" y="138" fill="#A1A1AA" font-family="Consolas, monospace" font-size="16" letter-spacing="1.2">${escapeSvg(langs.toUpperCase())}</text>

  <text x="76" y="232" fill="#F8FAFC" font-family="Segoe UI, system-ui, sans-serif" font-size="52" font-weight="800" letter-spacing="-1.2">${escapeSvg(portal.name)}</text>
  <text x="76" y="286" fill="#F59E0B" font-family="Segoe UI, system-ui, sans-serif" font-size="25" font-weight="600">${escapeSvg(portal.kicker)}</text>

  <rect x="76" y="356" width="664" height="68" rx="14" fill="#0D0F15" stroke="#272A36" />
  <text x="104" y="397" fill="#FBBF24" font-family="Consolas, monospace" font-size="20" font-weight="700">$</text>
  <text x="130" y="397" fill="#F8FAFC" font-family="Consolas, monospace" font-size="20">${escapeSvg(install)}</text>

  <text x="76" y="492" fill="#71717A" font-family="Consolas, monospace" font-size="16">s0d3s.github.io/${escapeSvg(portal.name)}/</text>
</svg>`;
}

async function resolvePortalSourceBuffer(portal) {
  if (portal.vendoredPreviewAsset) {
    const localPath = path.resolve(ROOT_DIR, portal.vendoredPreviewAsset);
    try {
      return await fs.readFile(localPath);
    } catch {
      // Fall back to synthesized architectural SVG if vendored file is absent
    }
  }

  return Buffer.from(buildSynthesizedPortalPreviewSvg(portal), 'utf-8');
}

async function readVendoredOssAsset(vendoredAssetPath, projectName) {
  const localPath = path.resolve(ROOT_DIR, vendoredAssetPath);
  try {
    return await fs.readFile(localPath);
  } catch {
    throw new Error(
      `Missing vendored asset '${vendoredAssetPath}' for '${projectName}'. Run 'npm run sync:catalog' to vendor upstream media.`,
    );
  }
}

async function generateOssVisualAssets(openSourceProjects) {
  await fs.mkdir(OSS_MEDIA_DIR, { recursive: true });
  let count = 0;

  for (const proj of openSourceProjects ?? []) {
    const visual = proj.visual;
    if (!visual?.vendoredAsset) continue;
    const slug = proj.mediaSlug || proj.name.toLowerCase().replace(/[^a-z0-9-]+/g, '-');
    const srcBuf = await readVendoredOssAsset(visual.vendoredAsset, proj.name);

    if (visual.kind === 'animated-demo') {
      const targetW = visual.width || 250;
      const targetH = visual.height || 300;
      // Lightweight Frame-0 static poster (< 8 KB AVIF) for instant zero-CLS initial load
      await sharp(srcBuf, { page: 0 })
        .resize(targetW, targetH, { fit: 'cover', kernel: sharp.kernel.lanczos3 })
        .avif({ quality: 60, effort: 4 })
        .toFile(path.join(OSS_MEDIA_DIR, `${slug}-poster.avif`));
      await sharp(srcBuf, { page: 0 })
        .resize(targetW, targetH, { fit: 'cover', kernel: sharp.kernel.lanczos3 })
        .webp({ quality: 80 })
        .toFile(path.join(OSS_MEDIA_DIR, `${slug}-poster.webp`));

      // Self-hosted animated WebP loaded only post-idle when scrolled into view
      await sharp(srcBuf, { animated: true, limitInputPixels: false })
        .webp({ quality: 72, effort: 5 })
        .toFile(path.join(OSS_MEDIA_DIR, `${slug}-anim.webp`));
      count += 3;
    } else if (visual.kind === 'banner') {
      for (const width of [360, 640]) {
        const aspect = (visual.height || 284) / (visual.width || 640);
        const height = Math.round(width * aspect);
        const baseOut = path.join(OSS_MEDIA_DIR, `${slug}-${width}`);
        await sharp(srcBuf)
          .resize(width, height, { fit: 'cover', kernel: sharp.kernel.lanczos3 })
          .avif({ quality: 60, effort: 4 })
          .toFile(`${baseOut}.avif`);
        await sharp(srcBuf)
          .resize(width, height, { fit: 'cover', kernel: sharp.kernel.lanczos3 })
          .webp({ quality: 80 })
          .toFile(`${baseOut}.webp`);
        count += 2;
      }
    }
  }

  return count;
}

async function main() {
  const snapshot = loadDiscoverySnapshot();

  await fs.mkdir(PREVIEWS_DIR, { recursive: true });

  // 1. Generate SEO multi-size PNGs + multi-resolution /favicon.ico from master 1254x1254 PNG
  const favicons = await generateFaviconSuite();
  const masterEmblemBuf = await fs.readFile(DEFAULT_FAVICON_SOURCE);

  // 2. Generate crisp 64x64 Retina brand mark for sticky header
  await sharp(masterEmblemBuf)
    .resize(64, 64, { fit: 'cover', kernel: sharp.kernel.lanczos3 })
    .webp({ quality: 88 })
    .toFile(path.join(GENERATED_DIR, 'brand-mark-64.webp'));
  await sharp(masterEmblemBuf)
    .resize(64, 64, { fit: 'cover', kernel: sharp.kernel.lanczos3 })
    .png({ compressionLevel: 9 })
    .toFile(path.join(GENERATED_DIR, 'brand-mark-64.png'));

  // 3. Render domain-root OpenGraph 1280x640 PNG card with composited rounded master emblem
  const roundedMask = Buffer.from(
    '<svg width="220" height="220"><rect x="0" y="0" width="220" height="220" rx="24" ry="24" fill="#fff"/></svg>',
  );
  const ogEmblemOverlay = await sharp(masterEmblemBuf)
    .resize(220, 220, { fit: 'cover', kernel: sharp.kernel.lanczos3 })
    .ensureAlpha()
    .composite([{ input: roundedMask, blend: 'dest-in' }])
    .png()
    .toBuffer();

  const ogSvgBuffer = Buffer.from(buildDomainOgSvg(snapshot), 'utf-8');
  await sharp(ogSvgBuffer)
    .resize(1280, 640)
    .composite([{ input: ogEmblemOverlay, left: 948, top: 100 }])
    .png({ compressionLevel: 9 })
    .toFile(OG_CARD_PATH);

  // 4. Render responsive AVIF + WebP previews (640x320 and 960x480) for each hosted portal
  for (const portal of snapshot.hostedPortals) {
    const srcBuffer = await resolvePortalSourceBuffer(portal);
    for (const width of [640, 960]) {
      const height = Math.round(width / 2);
      const baseOut = path.join(PREVIEWS_DIR, `${portal.previewSlug}-${width}`);
      await sharp(srcBuffer)
        .resize(width, height, { fit: 'cover', position: 'centre' })
        .avif({ quality: 62, effort: 4 })
        .toFile(`${baseOut}.avif`);
      await sharp(srcBuffer)
        .resize(width, height, { fit: 'cover', position: 'centre' })
        .webp({ quality: 80 })
        .toFile(`${baseOut}.webp`);
    }
  }

  // 5. Render optimized OSS demo posters, post-idle animated WebP, and secondary AVIF/WebP banners
  const ossAssetCount = await generateOssVisualAssets(snapshot.openSourceProjects);

  console.log(
    `[prepare-assets] Generated ${favicons.files.length} favicons, ${OG_CARD_PATH}, AVIF/WebP previews for ${snapshot.hostedPortals.length} portals, and ${ossAssetCount} OSS visual assets.`,
  );
}

main().catch((err) => {
  console.error('[prepare-assets] ERROR:', err);
  process.exit(1);
});
