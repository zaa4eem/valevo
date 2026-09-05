/*
 * ZAA4EEM service worker.
 *
 * Deliberately conservative: HTML is never served from cache while the
 * network is reachable, because a social feed that shows yesterday's posts
 * is worse than one that takes an extra moment. What it does do:
 *   - makes the site installable (a fetch handler is a hard requirement)
 *   - serves Next's content-hashed static assets from cache instantly
 *   - shows a real page instead of the browser's dinosaur when offline
 *
 * Web Push handlers get added here in the notifications stage; the file
 * exists now so the registration and the install prompt already work.
 */

const VERSION = 'v1';
const STATIC_CACHE = `zaa4eem-static-${VERSION}`;
const SHELL_CACHE = `zaa4eem-shell-${VERSION}`;
const OFFLINE_URL = '/offline.html';

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(SHELL_CACHE)
      .then((cache) => cache.add(OFFLINE_URL))
      .then(() => self.skipWaiting())
      .catch(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys
            .filter((key) => key.startsWith('zaa4eem-') && !key.endsWith(VERSION))
            .map((key) => caches.delete(key)),
        ),
      )
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  // Content-hashed build output: the URL changes whenever the bytes do, so
  // it can be served from cache forever without ever going stale.
  if (url.pathname.startsWith('/_next/static/')) {
    event.respondWith(
      caches.match(request).then(
        (hit) =>
          hit ||
          fetch(request).then((response) => {
            const copy = response.clone();
            caches.open(STATIC_CACHE).then((cache) => cache.put(request, copy));
            return response;
          }),
      ),
    );
    return;
  }

  // Pages: always try the network first, fall back to the offline page only
  // when there's genuinely no connection.
  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request).catch(() => caches.match(OFFLINE_URL).then((hit) => hit || Response.error())),
    );
  }
});
