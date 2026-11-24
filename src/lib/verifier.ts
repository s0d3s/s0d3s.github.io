import fs from 'node:fs/promises';
import path from 'node:path';
import { inspectSitemapXml, parseTagAttributes, stripHtmlTags } from './parsers.ts';

export interface VerificationIssue {
  code: string;
  file: string;
  message: string;
}

async function existsFile(filePath: string): Promise<boolean> {
  try {
    const st = await fs.stat(filePath);
    return st.isFile();
  } catch {
    return false;
  }
}

export async function verifyBuiltDist(
  distDir: string,
  siteOrigin = 'https://s0d3s.github.io',
): Promise<VerificationIssue[]> {
  const origin = siteOrigin.replace(/\/$/, '');
  const issues: VerificationIssue[] = [];

  const requiredFiles = [
    'index.html',
    '404.html',
    'robots.txt',
    'sitemap-index.xml',
    'sitemap-root.xml',
    'llms.txt',
    'llms-full.txt',
    '.well-known/llms.txt',
    '.nojekyll',
    'googlef1d57fb81fb3e9b2.html',
    'favicon.ico',
    'favicon-48x48.png',
    'favicon-96x96.png',
    'favicon-192x192.png',
    'favicon-512x512.png',
    'apple-touch-icon.png',
    'site.webmanifest',
    'og-card-1280x640.png',
  ];

  for (const rel of requiredFiles) {
    if (!(await existsFile(path.join(distDir, rel)))) {
      issues.push({
        code: 'missing_required_file',
        file: rel,
        message: `Missing required built artifact '${rel}'.`,
      });
    }
  }

  for (const forbiddenSmall of ['favicon-16x16.png', 'favicon-32x32.png']) {
    if (await existsFile(path.join(distDir, forbiddenSmall))) {
      issues.push({
        code: 'sub_48px_favicon_forbidden',
        file: forbiddenSmall,
        message: `Favicon '${forbiddenSmall}' is smaller than 48x48 and degrades downscaled quality.`,
      });
    }
  }

  // Ensure raw max-size master source and vendored upstream sources are NOT copied into deployed dist/
  if (await existsFile(path.join(distDir, 'favicon_1254x1254.png'))) {
    issues.push({
      code: 'unoptimized_master_favicon_deployed',
      file: 'favicon_1254x1254.png',
      message:
        'Master 1254x1254 source PNG must remain in src/assets/ and not be deployed raw in dist/.',
    });
  }
  for (const rawVendor of [
    'oss-positioner.gif',
    'oss-sqlciphermultiplatform.png',
    'portal-capture-system-or-process-audio.png',
  ]) {
    if (await existsFile(path.join(distDir, rawVendor))) {
      issues.push({
        code: 'unoptimized_vendored_asset_deployed',
        file: rawVendor,
        message: `Raw vendored source '${rawVendor}' must remain in src/assets/vendor/ and not be deployed in dist/.`,
      });
    }
  }

  // Validate binary /favicon.ico header, >= 48x48 floor, & Google 48px-multiple presence
  const icoPath = path.join(distDir, 'favicon.ico');
  if (await existsFile(icoPath)) {
    const icoBuf = await fs.readFile(icoPath);
    if (
      icoBuf.length < 22 ||
      icoBuf.readUInt16LE(0) !== 0 ||
      icoBuf.readUInt16LE(2) !== 1 ||
      icoBuf.readUInt16LE(4) < 1
    ) {
      issues.push({
        code: 'invalid_ico_header',
        file: 'favicon.ico',
        message: 'favicon.ico does not have a valid ICONDIR header.',
      });
    } else {
      const count = icoBuf.readUInt16LE(4);
      let has48Multiple = false;
      for (let i = 0; i < count; i++) {
        const entryOffset = 6 + i * 16;
        if (entryOffset + 16 > icoBuf.length) break;
        const w = icoBuf.readUInt8(entryOffset) || 256;
        const h = icoBuf.readUInt8(entryOffset + 1) || 256;
        if (w < 48 || h < 48) {
          issues.push({
            code: 'ico_frame_below_48px',
            file: 'favicon.ico',
            message: `favicon.ico contains ${w}x${h} frame (< 48x48); minimum allowed is 48x48.`,
          });
        }
        if (w === h && w >= 48 && w % 48 === 0) {
          has48Multiple = true;
        }
      }
      if (!has48Multiple) {
        issues.push({
          code: 'ico_missing_48px_multiple',
          file: 'favicon.ico',
          message: 'favicon.ico must contain a 48px-multiple square frame for Google Search.',
        });
      }
    }
  }

  // 1. Validate robots.txt
  const robotsPath = path.join(distDir, 'robots.txt');
  if (await existsFile(robotsPath)) {
    const robotsTxt = await fs.readFile(robotsPath, 'utf-8');
    if (!robotsTxt.includes(`Sitemap: ${origin}/sitemap-index.xml`)) {
      issues.push({
        code: 'robots_missing_sitemap',
        file: 'robots.txt',
        message: `robots.txt must declare 'Sitemap: ${origin}/sitemap-index.xml'.`,
      });
    }
    for (const line of robotsTxt.split(/\r?\n/)) {
      const clean = line.split('#')[0]?.trim() ?? '';
      if (/^disallow\s*:\s*\/\s*$/i.test(clean)) {
        issues.push({
          code: 'robots_root_disallow',
          file: 'robots.txt',
          message: 'robots.txt contains bare Disallow: / blocking the entire domain.',
        });
      }
    }
  }

  // 2. Validate sitemap-index.xml and all local child <urlset> XML files
  const smIndexPath = path.join(distDir, 'sitemap-index.xml');
  if (await existsFile(smIndexPath)) {
    const smRaw = await fs.readFile(smIndexPath, 'utf-8');
    const parsedIndex = inspectSitemapXml(smRaw);
    if (parsedIndex.kind !== 'sitemapindex') {
      issues.push({
        code: 'invalid_sitemap_index',
        file: 'sitemap-index.xml',
        message: 'Root sitemap-index.xml must be a valid <sitemapindex>.',
      });
    } else if (parsedIndex.locs.length === 0) {
      issues.push({
        code: 'empty_sitemap_index',
        file: 'sitemap-index.xml',
        message: 'sitemap-index.xml contains zero child <sitemap><loc> entries.',
      });
    } else {
      for (const loc of parsedIndex.locs) {
        if (!loc.startsWith(`${origin}/`)) {
          issues.push({
            code: 'foreign_sitemap_loc',
            file: 'sitemap-index.xml',
            message: `Sitemap <loc> '${loc}' is outside '${origin}/'.`,
          });
          continue;
        }
        const subRel = loc.slice(`${origin}/`.length);
        // Root-level XML files live inside distDir; nested project XMLs live in sibling repos
        if (!subRel.includes('/')) {
          const childPath = path.join(distDir, subRel);
          if (!(await existsFile(childPath))) {
            issues.push({
              code: 'missing_local_sitemap',
              file: 'sitemap-index.xml',
              message: `Referenced local sitemap '${subRel}' does not exist in dist.`,
            });
          } else {
            const childRaw = await fs.readFile(childPath, 'utf-8');
            const childParsed = inspectSitemapXml(childRaw);
            if (childParsed.kind !== 'urlset') {
              issues.push({
                code: 'nested_sitemap_index_forbidden',
                file: subRel,
                message: `Child sitemap '${subRel}' must be <urlset>, found '${childParsed.kind}'.`,
              });
            } else if (childParsed.locs.some((u) => !u.startsWith(`${origin}/`))) {
              issues.push({
                code: 'invalid_urlset_loc',
                file: subRel,
                message: `Child sitemap '${subRel}' contains URL outside '${origin}/'.`,
              });
            }
          }
        } else if (subRel.endsWith('sitemap-index.xml')) {
          issues.push({
            code: 'unwrapped_nested_sitemap_index',
            file: 'sitemap-index.xml',
            message: `Nested sitemap index '${loc}' must be unwrapped to leaf <urlset> URLs.`,
          });
        }
      }
    }
  }

  // 3. Validate llms.txt & llms-full.txt
  for (const llmRel of ['llms.txt', 'llms-full.txt', '.well-known/llms.txt']) {
    const p = path.join(distDir, llmRel);
    if (await existsFile(p)) {
      const content = (await fs.readFile(p, 'utf-8')).trim();
      if (!content.startsWith('# ') || content.length < 200) {
        issues.push({
          code: 'invalid_llms_txt',
          file: llmRel,
          message: `${llmRel} must begin with an H1 heading and contain substantial Markdown context.`,
        });
      }
    }
  }

  // 4. Validate index.html SEO, accessibility, anchors, local assets, and JSON-LD @graph
  const indexPath = path.join(distDir, 'index.html');
  if (await existsFile(indexPath)) {
    const html = await fs.readFile(indexPath, 'utf-8');
    const titleMatch = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
    const title = titleMatch ? stripHtmlTags(titleMatch[1] ?? '') : '';
    if (title.length < 20 || title.length > 70) {
      issues.push({
        code: 'invalid_title_length',
        file: 'index.html',
        message: `<title> length ${title.length} outside recommended 20..70 range.`,
      });
    }

    const h1Count = [...html.matchAll(/<h1\b/gi)].length;
    if (h1Count !== 1) {
      issues.push({
        code: 'invalid_h1_count',
        file: 'index.html',
        message: `Expected exactly 1 <h1> on landing page, found ${h1Count}.`,
      });
    }

    let metaDesc = '';
    let canonical = '';
    let twitterCard = '';
    const og: Record<string, string> = {};

    for (const m of html.matchAll(/<meta\b([^>]*?)\/?>/gi)) {
      const attrs = parseTagAttributes(m[1] ?? '');
      const name = (attrs.name ?? '').toLowerCase();
      const prop = (attrs.property ?? '').toLowerCase();
      const content = (attrs.content ?? '').trim();
      if (name === 'description' && !metaDesc) metaDesc = content;
      if (name === 'twitter:card' && !twitterCard) twitterCard = content;
      if (prop.startsWith('og:')) og[prop] = content;
    }

    let hasGoogle48MultipleIconLink = false;
    for (const l of html.matchAll(/<link\b([^>]*?)\/?>/gi)) {
      const attrs = parseTagAttributes(l[1] ?? '');
      const rels = new Set((attrs.rel ?? '').toLowerCase().split(/\s+/));
      if (rels.has('canonical') && !canonical) canonical = attrs.href ?? '';
      if (rels.has('icon')) {
        const iconHref = (attrs.href ?? '').trim();
        const iconType = (attrs.type ?? '').toLowerCase();
        if (iconType === 'image/svg+xml' || iconHref.endsWith('.svg')) {
          issues.push({
            code: 'svg_favicon_forbidden_for_google_seo',
            file: 'index.html',
            message: `Avoid SVG favicon '${iconHref}'; use 48px-multiple PNG/ICO favicons for Google Search.`,
          });
        }
        for (const token of (attrs.sizes ?? '').split(/\s+/)) {
          const mSize = token.match(/^(\d+)x(\d+)$/i);
          if (mSize) {
            const w = Number(mSize[1]);
            const h = Number(mSize[2]);
            if (w < 48 || h < 48) {
              issues.push({
                code: 'favicon_size_below_48px',
                file: 'index.html',
                message: `Icon '${iconHref}' declares size '${token}' (< 48x48); minimum allowed is 48x48.`,
              });
            }
            if (w === h && w >= 48 && w % 48 === 0) {
              hasGoogle48MultipleIconLink = true;
            }
          }
        }
        if (iconHref.startsWith('/') && !iconHref.startsWith('//')) {
          const relIcon = iconHref.replace(/^\/+/, '');
          if (!(await existsFile(path.join(distDir, relIcon)))) {
            issues.push({
              code: 'missing_favicon_file',
              file: 'index.html',
              message: `Referenced icon '${iconHref}' does not exist in dist.`,
            });
          }
        }
      }
    }

    if (!hasGoogle48MultipleIconLink) {
      issues.push({
        code: 'missing_48px_multiple_favicon_link',
        file: 'index.html',
        message:
          'Landing <head> must declare at least one 48px-multiple raster <link rel="icon"> (e.g. 48x48, 96x96, 192x192) for Google Search.',
      });
    }

    if (metaDesc.length < 70 || metaDesc.length > 175) {
      issues.push({
        code: 'invalid_meta_description',
        file: 'index.html',
        message: `<meta name="description"> length ${metaDesc.length} outside 70..175.`,
      });
    }

    if (canonical !== `${origin}/`) {
      issues.push({
        code: 'invalid_canonical',
        file: 'index.html',
        message: `Expected canonical '${origin}/', got '${canonical}'.`,
      });
    }

    for (const reqOg of ['og:title', 'og:description', 'og:url', 'og:image']) {
      if (!og[reqOg]) {
        issues.push({
          code: 'missing_og_tag',
          file: 'index.html',
          message: `Missing OpenGraph tag '${reqOg}'.`,
        });
      }
    }
    if (!twitterCard) {
      issues.push({
        code: 'missing_twitter_card',
        file: 'index.html',
        message: 'Missing twitter:card meta tag.',
      });
    }

    // Collect element IDs for internal #anchor verification
    const ids = new Set<string>();
    for (const idMatch of html.matchAll(/\bid\s*=\s*(?:"([^"]+)"|'([^']+)')/gi)) {
      const idVal = (idMatch[1] ?? idMatch[2] ?? '').trim();
      if (idVal) ids.add(idVal);
    }

    // Verify anchor hrefs and root-relative file references
    for (const aMatch of html.matchAll(/<a\b([^>]*)>/gi)) {
      const attrs = parseTagAttributes(aMatch[1] ?? '');
      const href = (attrs.href ?? '').trim();
      if (!href) continue;
      if (href.startsWith('#')) {
        const frag = href.slice(1);
        if (frag && !ids.has(frag)) {
          issues.push({
            code: 'broken_anchor',
            file: 'index.html',
            message: `Broken internal anchor '#${frag}'.`,
          });
        }
      } else if (href.startsWith('/') && !href.startsWith('//')) {
        const cleanRel = (href.split('#')[0] ?? '').replace(/^\/+/, '');
        const candidateFile = cleanRel
          ? path.join(distDir, cleanRel)
          : path.join(distDir, 'index.html');
        const candidateDirIndex = path.join(distDir, cleanRel, 'index.html');
        if (!(await existsFile(candidateFile)) && !(await existsFile(candidateDirIndex))) {
          issues.push({
            code: 'broken_local_link',
            file: 'index.html',
            message: `Unresolved root-relative link '${href}'.`,
          });
        }
      }
    }

    // Verify non-decorative <img> alt attributes and local image files
    for (const imgMatch of html.matchAll(/<img\b([^>]*?)\/?>/gi)) {
      const attrs = parseTagAttributes(imgMatch[1] ?? '');
      const isHidden = (attrs['aria-hidden'] ?? '').toLowerCase() === 'true';
      if (!isHidden && !(attrs.alt ?? '').trim()) {
        issues.push({
          code: 'missing_img_alt',
          file: 'index.html',
          message: `Image '${attrs.src ?? '<unknown>'}' missing descriptive alt text.`,
        });
      }
      const src = attrs.src ?? '';
      if (/raw\.githubusercontent\.com/i.test(src) || /\.gif$/i.test(src)) {
        issues.push({
          code: 'unoptimized_external_or_gif_img',
          file: 'index.html',
          message: `Image '${src}' hotlinks raw GitHub media or uses unoptimized .gif in initial HTML.`,
        });
      }
      if (src.startsWith('/') && !src.startsWith('//')) {
        const imgRel = src.replace(/^\/+/, '');
        if (!(await existsFile(path.join(distDir, imgRel)))) {
          issues.push({
            code: 'missing_local_image',
            file: 'index.html',
            message: `Image file '${src}' does not exist in dist.`,
          });
        }
      }
    }

    // Verify deferred data-anim-src / data-poster-src local targets exist in dist
    for (const animAttrMatch of html.matchAll(
      /\bdata-(?:anim|poster)-src\s*=\s*(?:"([^"]+)"|'([^']+)')/gi,
    )) {
      const refPath = (animAttrMatch[1] ?? animAttrMatch[2] ?? '').trim();
      if (refPath.startsWith('/') && !refPath.startsWith('//')) {
        if (!(await existsFile(path.join(distDir, refPath.replace(/^\/+/, ''))))) {
          issues.push({
            code: 'missing_deferred_anim_asset',
            file: 'index.html',
            message: `Deferred animation asset '${refPath}' does not exist in dist.`,
          });
        }
      }
    }

    // Ensure zero client-side external API requests in executable <script> blocks
    for (const scriptMatch of html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)) {
      const attrs = parseTagAttributes(scriptMatch[1] ?? '');
      const sType = (attrs.type ?? '').toLowerCase();
      if (sType === 'application/ld+json') continue;
      const body = scriptMatch[2] ?? '';
      if (
        /\bfetch\s*\(/i.test(body) ||
        /\bXMLHttpRequest\b/i.test(body) ||
        /api\.github\.com|pypi\.org\/pypi|crates\.io\/api/i.test(body)
      ) {
        issues.push({
          code: 'client_side_api_request_forbidden',
          file: 'index.html',
          message:
            'Executable client <script> must not issue network/API requests; dynamic metrics are resolved strictly at build time.',
        });
      }
    }

    // Verify Schema.org JSON-LD @graph contains Person, WebSite, ProfilePage, ItemList (without non-eligible FAQPage)
    const ldMatches = [
      ...html.matchAll(
        /<script\b[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi,
      ),
    ];
    if (ldMatches.length === 0) {
      issues.push({
        code: 'missing_jsonld',
        file: 'index.html',
        message: 'Missing application/ld+json structured data script.',
      });
    } else {
      const seenTypes = new Set<string>();
      for (const m of ldMatches) {
        try {
          const parsed = JSON.parse((m[1] ?? '').trim()) as Record<string, unknown>;
          const nodes = Array.isArray(parsed['@graph']) ? parsed['@graph'] : [parsed];
          for (const node of nodes) {
            if (node && typeof node === 'object') {
              const t = (node as Record<string, unknown>)['@type'];
              if (typeof t === 'string') seenTypes.add(t);
            }
          }
        } catch {
          issues.push({
            code: 'malformed_jsonld',
            file: 'index.html',
            message: 'Malformed JSON inside application/ld+json block.',
          });
        }
      }
      for (const requiredType of ['Person', 'WebSite', 'ProfilePage', 'ItemList']) {
        if (!seenTypes.has(requiredType)) {
          issues.push({
            code: 'incomplete_jsonld_graph',
            file: 'index.html',
            message: `JSON-LD @graph missing required Schema.org type '${requiredType}'.`,
          });
        }
      }
      if (seenTypes.has('FAQPage')) {
        issues.push({
          code: 'deprecated_faqpage_jsonld',
          file: 'index.html',
          message:
            'JSON-LD @graph must not emit FAQPage on developer/portfolio domains; use semantic tables and deep links instead.',
        });
      }
    }

    if (!/<table\b[^>]*class=["'][^"']*matrix-table/i.test(html)) {
      issues.push({
        code: 'missing_technical_matrix_table',
        file: 'index.html',
        message: 'Landing page must render semantic <table class="matrix-table"> routing matrix.',
      });
    }

    if (!html.includes('/capture-system-or-process-audio/api/rust/')) {
      issues.push({
        code: 'missing_rustdoc_deep_links',
        file: 'index.html',
        message: 'Landing page must expose direct crawlable links to hosted /api/rust/ crates.',
      });
    }
  }

  return issues;
}
