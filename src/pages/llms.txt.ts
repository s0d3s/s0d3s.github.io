import type { APIRoute } from 'astro';
import { generateLlmsTxt } from '../lib/seo-generators.ts';
import { loadDiscoverySnapshot } from '../lib/snapshot.ts';

export const GET: APIRoute = () => {
  const snapshot = loadDiscoverySnapshot();
  return new Response(generateLlmsTxt(snapshot), {
    headers: {
      'Content-Type': 'text/plain; charset=utf-8',
    },
  });
};
