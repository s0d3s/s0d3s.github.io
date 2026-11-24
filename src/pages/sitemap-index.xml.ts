import type { APIRoute } from 'astro';
import { generateSitemapIndexXml } from '../lib/seo-generators.ts';
import { loadDiscoverySnapshot } from '../lib/snapshot.ts';

export const GET: APIRoute = () => {
  const snapshot = loadDiscoverySnapshot();
  return new Response(generateSitemapIndexXml(snapshot), {
    headers: {
      'Content-Type': 'application/xml; charset=utf-8',
    },
  });
};
