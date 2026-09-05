'use client';

import { useRef, type ReactNode } from 'react';

/**
 * A card that tilts towards the pointer.
 *
 * Kept to a few degrees on purpose: the effect should register as the card
 * being a physical thing under your finger, not as the page moving. Pointer
 * events only — a touch device gets nothing, because there is no hover to
 * respond to and a tilt fighting a scroll is worse than no tilt.
 */
export function TiltCard({
  children,
  className,
  title,
  maxTilt = 6,
}: {
  children: ReactNode;
  className?: string;
  title?: string;
  maxTilt?: number;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const enabled = useRef<boolean | null>(null);

  function allowed(): boolean {
    if (enabled.current === null) {
      enabled.current =
        typeof window !== 'undefined' &&
        window.matchMedia('(hover: hover) and (pointer: fine)').matches &&
        !window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    }
    return enabled.current;
  }

  function onMove(e: React.PointerEvent<HTMLDivElement>) {
    if (maxTilt === 0 || !allowed() || !ref.current) return;
    const rect = ref.current.getBoundingClientRect();
    const x = (e.clientX - rect.left) / rect.width - 0.5;
    const y = (e.clientY - rect.top) / rect.height - 0.5;
    ref.current.style.transform = `perspective(900px) rotateX(${-y * maxTilt}deg) rotateY(${x * maxTilt}deg)`;
  }

  function reset() {
    if (ref.current) ref.current.style.transform = '';
  }

  return (
    <div
      ref={ref}
      className={`z-tilt${className ? ` ${className}` : ''}`}
      title={title}
      onPointerMove={onMove}
      onPointerLeave={reset}
    >
      {children}
    </div>
  );
}
