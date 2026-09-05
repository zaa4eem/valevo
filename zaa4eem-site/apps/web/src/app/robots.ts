import type { MetadataRoute } from 'next';

const SITE_URL = (process.env.NEXT_PUBLIC_SITE_URL || 'https://zaa4eem.ru').replace(/\/$/, '');

/**
 * Replaces the static public/robots.txt so the sitemap URL follows whatever
 * domain the deployment actually runs on instead of being hardcoded.
 */
export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: '*',
      allow: '/',
      disallow: ['/admin', '/settings'],
    },
    sitemap: `${SITE_URL}/sitemap.xml`,
  };
}
