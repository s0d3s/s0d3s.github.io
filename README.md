# s0d3s.github.io

Domain-root developer hub, automatic nested project discovery engine, and unified SEO / GEO router (`robots.txt`, `sitemap-index.xml`, synthesized sub-project sitemaps, `llms.txt`, `llms-full.txt`, and Schema.org `@graph`) for **[https://s0d3s.github.io/](https://s0d3s.github.io/)**.

## Quick Start(if you want to try locally;)

Requires **Node.js >= 26.0.0**.

```bash
npm install

# Refresh committed project/sitemap catalog & vendored media (maintainer review -> git commit)
npm run sync:catalog

# Refresh only dynamic telemetry (stars, forks, updatedAt, PyPI & crates.io versions)
npm run sync:dynamic

# Export the full Google-SEO favicon pack for this site or any external directory
npm run generate:favicons -- --out ./custom-icons-dir

# Build with fresh dynamic telemetry + local sharp AVIF/WebP assets into dist/
npm run build

# Build 100% offline from committed catalog and vendored assets (zero network calls)
npm run build:offline

# Run unit tests, linter/type checks, and built-site SEO/GEO verification
npm test
npm run check
npm run verify
```

## License

Dual-licensed under [MIT](LICENSE-MIT) or [Apache-2.0](LICENSE-APACHE), at your option.
