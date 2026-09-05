'use client';

import { useLayoutEffect, useRef } from 'react';

/**
 * FLIP animation for a reordering list.
 *
 * First / Last / Invert / Play: measure where each row was, let React move
 * it, then transform it back to the old position and release. The browser
 * animates a transform on the compositor, so a leaderboard reshuffling
 * costs nothing even with thirty rows — and a rank changing becomes
 * something you *see* happen rather than something you notice happened.
 *
 * Keyed by a stable id per row, so a row that merely re-renders doesn't
 * animate and a row that actually moved does.
 */
export function useFlip<T extends HTMLElement>(keys: string[]) {
  const nodes = useRef(new Map<string, T>());
  const positions = useRef(new Map<string, number>());

  useLayoutEffect(() => {
    if (typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      return;
    }

    const previous = positions.current;
    const next = new Map<string, number>();

    for (const key of keys) {
      const node = nodes.current.get(key);
      if (!node) continue;
      const top = node.getBoundingClientRect().top;
      next.set(key, top);

      const before = previous.get(key);
      // A row that wasn't on screen last time has nothing to move from.
      if (before === undefined || Math.abs(before - top) < 1) continue;

      node.style.transition = 'none';
      node.style.transform = `translateY(${before - top}px)`;
      // Force a reflow so the browser takes the inverted position as the
      // starting frame rather than optimising both writes into one.
      void node.offsetHeight;
      node.style.transition = 'transform 0.45s cubic-bezier(0.22, 1, 0.36, 1)';
      node.style.transform = '';
    }

    positions.current = next;
  }, [keys]);

  return (key: string) => (node: T | null) => {
    if (node) nodes.current.set(key, node);
    else nodes.current.delete(key);
  };
}
