'use client';

import { useEffect } from 'react';

/**
 * Registers public/sw.js after the page has settled. Renders nothing.
 *
 * Registration is deliberately deferred to the load event: doing it during
 * hydration competes with the very requests that make the first paint fast,
 * which would undo part of what the service worker is there to help with.
 */
export function ServiceWorkerRegistrar() {
  useEffect(() => {
    if (typeof window === 'undefined') return;
    if (!('serviceWorker' in navigator)) return;
    // A worker registered from a dev build would cache dev assets and then
    // serve them after a rebuild — confusing, and of no benefit locally.
    if (process.env.NODE_ENV !== 'production') return;

    function register() {
      navigator.serviceWorker.register('/sw.js').catch((err) => {
        console.warn('Service worker registration failed:', err);
      });
    }

    if (document.readyState === 'complete') {
      register();
      return;
    }
    window.addEventListener('load', register);
    return () => window.removeEventListener('load', register);
  }, []);

  return null;
}
