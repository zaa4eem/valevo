'use client';

import { useEffect, useRef, type ComponentProps } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';

/**
 * A Link that cross-fades between routes using the View Transitions API.
 *
 * Deliberately opt-in per link rather than a global click interceptor.
 * Next's `<Link>` calls preventDefault() in its own handler, so a
 * document-level listener either never fires (bubble phase, already
 * defaulted) or has to stopPropagation in the capture phase — which would
 * silently kill every `onClick` sitting on a link, and several here close a
 * menu that way. Wrapping the links that matter costs a few lines and
 * breaks nothing.
 *
 * The timing is the fiddly part: startViewTransition snapshots the page,
 * runs a callback, then animates towards whatever the DOM became once that
 * callback settles. `router.push` resolves before the new route renders, so
 * the callback stays pending until the pathname actually changes.
 */
const TRANSITION_TIMEOUT_MS = 800;

export function TransitionLink({
  href,
  onClick,
  children,
  ...rest
}: ComponentProps<typeof Link>) {
  const router = useRouter();
  const pathname = usePathname();
  const resolveRef = useRef<(() => void) | null>(null);

  // The new route has rendered — release the snapshot so it can animate.
  useEffect(() => {
    resolveRef.current?.();
    resolveRef.current = null;
  }, [pathname]);

  return (
    <Link
      href={href}
      {...rest}
      onClick={(event) => {
        onClick?.(event);

        // Anything but a plain left click means "new tab" or similar.
        if (event.defaultPrevented) return;
        if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || event.button !== 0) {
          return;
        }
        if (typeof document.startViewTransition !== 'function') return;
        if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;

        const target = typeof href === 'string' ? href : href.pathname;
        if (!target || target === pathname) return;

        event.preventDefault();
        document.startViewTransition(
          () =>
            new Promise<void>((resolve) => {
              let released = false;
              const release = () => {
                if (released) return;
                released = true;
                resolve();
              };
              resolveRef.current = release;
              // A slow or failed route must never leave the page frozen
              // under a snapshot.
              setTimeout(release, TRANSITION_TIMEOUT_MS);
              router.push(target);
            }),
        );
      }}
    >
      {children}
    </Link>
  );
}
