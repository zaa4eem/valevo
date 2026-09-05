'use client';

import { useEffect, useRef, useState } from 'react';

/**
 * A number that springs to its new value instead of snapping.
 *
 * Why it earns its place on the Z-coin balance: a counter that jumps from
 * 1240 to 1265 tells you the number changed; one that runs up through the
 * gap tells you *by how much*, which is the thing a player actually wants
 * to feel. The overshoot is what makes it read as a reward rather than a
 * data refresh.
 */
export function SpringNumber({
  value,
  className,
  duration = 550,
}: {
  value: number;
  className?: string;
  duration?: number;
}) {
  const [shown, setShown] = useState(value);
  const [bumping, setBumping] = useState(false);
  const fromRef = useRef(value);
  const rafRef = useRef(0);

  useEffect(() => {
    const from = fromRef.current;
    if (from === value) return;

    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      fromRef.current = value;
      setShown(value);
      return;
    }

    // Only an increase is a reward; a decrease (spending coins) shouldn't
    // get a celebratory bump.
    if (value > from) {
      setBumping(true);
      setTimeout(() => setBumping(false), 400);
    }

    const start = performance.now();
    const delta = value - from;

    function step(now: number) {
      const t = Math.min(1, (now - start) / duration);
      // Slight overshoot near the end, settling back — the "spring".
      const eased =
        t === 1 ? 1 : 1 - Math.pow(2, -10 * t) * Math.cos(((t * 10 - 0.75) * (2 * Math.PI)) / 3);
      setShown(Math.round(from + delta * eased));
      if (t < 1) {
        rafRef.current = requestAnimationFrame(step);
      } else {
        fromRef.current = value;
      }
    }

    rafRef.current = requestAnimationFrame(step);
    return () => cancelAnimationFrame(rafRef.current);
  }, [value, duration]);

  return (
    <span className={`${className ?? ''}${bumping ? ' z-number-bump' : ''}`}>
      {shown.toLocaleString('ru-RU')}
    </span>
  );
}
