import type { APIRoute, GetStaticPaths } from 'astro';
import { generateRootUrlsetXml, generateUrlsetXml } from '../lib/seo-generators.ts';
import { loadDiscoverySnapshot } from '../lib/snapshot.ts';

export const getStaticPaths: GetStaticPaths = () => {
  const snapshot = loadDiscoverySnapshot();
  const paths: { params: { sitemap: string }; props: { xml: string } }[] = [
    {
      params: { sitemap: 'sitemap-root' },
      props: { xml: generateRootUrlsetXml(snapshot) },
    },
  ];

  for (const synth of snapshot.synthesizedSitemaps) {
    const baseName = synth.filename.replace(/\.xml$/i, '');
    paths.push({
      params: { sitemap: baseName },
      props: { xml: generateUrlsetXml(synth.urls, snapshot.generatedAt) },
    });
  }

  return paths;
};

export const GET: APIRoute = ({ props }) => {
  const { xml } = props as { xml: string };
  return new Response(xml, {
    headers: {
      'Content-Type': 'application/xml; charset=utf-8',
    },
  });
};
