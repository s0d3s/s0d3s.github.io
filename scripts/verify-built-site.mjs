import path from 'node:path';
import { verifyBuiltDist } from '../src/lib/verifier.ts';

function parseDistArg(argv) {
  const idx = argv.indexOf('--dist');
  if (idx !== -1 && argv[idx + 1]) {
    return path.resolve(argv[idx + 1]);
  }
  return path.resolve('dist');
}

async function main() {
  const distDir = parseDistArg(process.argv.slice(2));
  const issues = await verifyBuiltDist(distDir);
  if (issues.length > 0) {
    console.error(`[verify-built-site] FAILED with ${issues.length} issue(s):`);
    for (const issue of issues) {
      console.error(`  - [${issue.code}] ${issue.file}: ${issue.message}`);
    }
    process.exit(1);
  }
  console.log(
    `[verify-built-site] OK — all HTML SEO, JSON-LD @graph, RFC 9309 robots.txt, Sitemaps 0.9, and llms*.txt checks passed (${distDir}).`,
  );
}

main().catch((err) => {
  console.error('[verify-built-site] ERROR:', err);
  process.exit(1);
});
