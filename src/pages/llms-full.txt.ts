import type { APIRoute } from 'astro';
import { generateLlmsFullTxt } from '../lib/seo-generators.ts';
import { buildTechnicalIndex, loadDiscoverySnapshot } from '../lib/snapshot.ts';

export const GET: APIRoute = () => {
  const snapshot = loadDiscoverySnapshot();
  return new Response(generateLlmsFullTxt(snapshot, buildTechnicalIndex(snapshot)), {
    headers: {
      'Content-Type': 'text/plain; charset=utf-8',
    },
  });
};
