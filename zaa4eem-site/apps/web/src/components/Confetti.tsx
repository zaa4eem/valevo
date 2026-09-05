'use client';

import { useEffect, useRef } from 'react';

/**
 * A burst of confetti, drawn on a canvas.
 *
 * Canvas rather than a few hundred DOM nodes: this fires at the exact
 * moment a record lands, when the page is also re-rendering a leaderboard,
 * and animating hundreds of elements through the compositor is how a
 * celebration turns into a stutter.
 *
 * Respects prefers-reduced-motion by simply not running — a celebration is
 * the definition of non-essential motion.
 */
export function Confetti({ fire, onDone }: { fire: boolean; onDone?: () => void }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    if (!fire) return;
    const canvas = canvasRef.current;
    if (!canvas) return;

    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      onDone?.();
      return;
    }

    const context = canvas.getContext('2d');
    if (!context) return;

    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const width = canvas.clientWidth;
    const height = canvas.clientHeight;
    canvas.width = width * dpr;
    canvas.height = height * dpr;
    context.scale(dpr, dpr);

    // Brand green plus its neighbours, so the burst reads as this site's
    // rather than a generic party popper.
    const colors = ['#4ade80', '#22c55e', '#a3e635', '#facc15', '#f4f7f5'];
    const pieces = Array.from({ length: 90 }, () => ({
      x: width / 2 + (Math.random() - 0.5) * width * 0.3,
      y: height * 0.45,
      vx: (Math.random() - 0.5) * 9,
      vy: -Math.random() * 11 - 4,
      size: 4 + Math.random() * 6,
      rotation: Math.random() * Math.PI,
      spin: (Math.random() - 0.5) * 0.3,
      color: colors[Math.floor(Math.random() * colors.length)],
      life: 1,
    }));

    let raf = 0;
    let running = true;

    function frame() {
      if (!running || !context) return;
      context.clearRect(0, 0, width, height);

      let alive = false;
      for (const piece of pieces) {
        piece.vy += 0.28; // gravity
        piece.vx *= 0.995;
        piece.x += piece.vx;
        piece.y += piece.vy;
        piece.rotation += piece.spin;
        piece.life -= 0.008;
        if (piece.life <= 0 || piece.y > height + 30) continue;
        alive = true;

        context.save();
        context.translate(piece.x, piece.y);
        context.rotate(piece.rotation);
        context.globalAlpha = Math.max(0, piece.life);
        context.fillStyle = piece.color;
        context.fillRect(-piece.size / 2, -piece.size / 4, piece.size, piece.size / 2);
        context.restore();
      }

      if (alive) {
        raf = requestAnimationFrame(frame);
      } else {
        context.clearRect(0, 0, width, height);
        onDone?.();
      }
    }

    raf = requestAnimationFrame(frame);
    return () => {
      running = false;
      cancelAnimationFrame(raf);
    };
  }, [fire, onDone]);

  if (!fire) return null;

  return <canvas ref={canvasRef} className="z-confetti" aria-hidden />;
}
