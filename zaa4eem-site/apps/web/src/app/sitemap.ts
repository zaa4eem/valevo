import type { MetadataRoute } from 'next';

const SITE_URL = (process.env.NEXT_PUBLIC_SITE_URL || 'https://zaa4eem.ru').replace(/\/$/, '');

/**
 * Only the stable public sections — profile and idea pages are excluded on
 * purpose: they're user-generated, unbounded in number, and change far more
 * often than a crawler needs to know about. Search engines find those by
 * following links from the pages below.
 */
export default function sitemap(): MetadataRoute.Sitemap {
  const paths: { path: string; priority: number; changeFrequency: 'daily' | 'weekly' | 'monthly' }[] = [
    { path: '/', priority: 1, changeFrequency: 'daily' },
    { path: '/ideas', priority: 0.9, changeFrequency: 'daily' },
    { path: '/games', priority: 0.9, changeFrequency: 'weekly' },
    { path: '/leaderboard', priority: 0.8, changeFrequency: 'daily' },
    { path: '/hall-of-fame', priority: 0.7, changeFrequency: 'weekly' },
    { path: '/shop', priority: 0.6, changeFrequency: 'weekly' },
    { path: '/search', priority: 0.5, changeFrequency: 'monthly' },
    { path: '/login', priority: 0.4, changeFrequency: 'monthly' },
    { path: '/legal/privacy', priority: 0.2, changeFrequency: 'monthly' },
    { path: '/legal/terms', priority: 0.2, changeFrequency: 'monthly' },
  ];

  const now = new Date();
  return paths.map(({ path, priority, changeFrequency }) => ({
    url: `${SITE_URL}${path}`,
    lastModified: now,
    changeFrequency,
    priority,
  }));
}
