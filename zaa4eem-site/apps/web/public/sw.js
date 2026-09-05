/*
 * ZAA4EEM service worker.
 *
 * Deliberately conservative: HTML is never served from cache while the
 * network is reachable, because a social feed that shows yesterday's posts
 * is worse than one that takes an extra moment. What it does do:
 *   - makes the site installable (a fetch handler is a hard requirement)
 *   - serves Next's content-hashed static assets from cache instantly
 *   - shows a real page instead of the browser's dinosaur when offline
 *   - receives Web Push and opens the right page when one is tapped
 */

const VERSION = 'v2';
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

// ---- Web Push ----

/**
 * The payload is written by the API (see PushService) and is always JSON with
 * title/body/url. A push with no readable payload still has to show something:
 * `userVisibleOnly: true` was promised at subscribe time, and browsers punish
 * a silent push by revoking the subscription.
 */
self.addEventListener('push', (event) => {
  let payload = {};
  try {
    payload = event.data ? event.data.json() : {};
  } catch (err) {
    payload = {};
  }

  const title = payload.title || 'ZAA4EEM';
  const options = {
    body: payload.body || 'Новое уведомление',
    icon: '/icon-192.png',
    badge: '/icon-192.png',
    data: { url: payload.url || '/notifications' },
    // Same tag = the newer one replaces the older instead of stacking a
    // column of near-identical banners on the lock screen.
    tag: payload.tag || 'zaa4eem',
    renotify: Boolean(payload.tag),
  };

  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const target = (event.notification.data && event.notification.data.url) || '/notifications';

  // Focus an existing tab when there is one — opening a fourth copy of the
  // site because someone tapped three notifications is not what they meant.
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientList) => {
      for (const client of clientList) {
        if ('focus' in client) {
          if ('navigate' in client) client.navigate(target).catch(() => undefined);
          return client.focus();
        }
      }
      return self.clients.openWindow(target);
    }),
  );
});
