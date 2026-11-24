import path from 'node:path';
import {
  DEFAULT_FAVICON_SOURCE,
  DEFAULT_PUBLIC_DIR,
  generateFaviconSuite,
} from '../src/lib/favicons.ts';

function parseArgValue(argv, flag) {
  const idx = argv.indexOf(flag);
  return idx !== -1 && argv[idx + 1] ? path.resolve(argv[idx + 1]) : undefined;
}

const argv = process.argv.slice(2);
const sourcePath = parseArgValue(argv, '--source') ?? DEFAULT_FAVICON_SOURCE;
const outDir = parseArgValue(argv, '--out') ?? DEFAULT_PUBLIC_DIR;

generateFaviconSuite({ sourcePath, outDir })
  .then((res) => {
    console.log(
      `[generate-favicons] Generated ${res.files.length} SEO favicon artifacts in ${res.outDir} from ${res.sourcePath}`,
    );
  })
  .catch((err) => {
    console.error('[generate-favicons] ERROR:', err);
    process.exit(1);
  });
