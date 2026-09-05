import type { MetadataRoute } from 'next';

/**
 * Makes the site installable: "Добавить на главный экран" on a phone, a
 * standalone window on desktop, and the prerequisite for Web Push later on.
 * Served at /manifest.webmanifest and linked automatically by Next.
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'ZAA4EEM — идеи, игры, лента',
    short_name: 'ZAA4EEM',
    description: 'Предлагай идеи, играй в мини-игры и следи за лидербордом.',
    lang: 'ru',
    start_url: '/',
    scope: '/',
    display: 'standalone',
    orientation: 'portrait',
    background_color: '#0b0e0d',
    theme_color: '#0b0e0d',
    categories: ['social', 'games', 'entertainment'],
    icons: [
      { src: '/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
      { src: '/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
      // Android crops this one to its own shape, so it carries its own padding.
      { src: '/icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
    ],
    shortcuts: [
      { name: 'Игры', short_name: 'Игры', url: '/games' },
      { name: 'Идеи', short_name: 'Идеи', url: '/ideas' },
      { name: 'Лидеры', short_name: 'Лидеры', url: '/leaderboard' },
    ],
  };
}
