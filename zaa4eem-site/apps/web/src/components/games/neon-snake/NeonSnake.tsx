'use client';

import { useEffect, useRef, useState } from 'react';
import { SnakeEngine } from './engine';

const KEY_TO_DIRECTION: Record<string, 'UP' | 'DOWN' | 'LEFT' | 'RIGHT'> = {
  ArrowUp: 'UP',
  ArrowDown: 'DOWN',
  ArrowLeft: 'LEFT',
  ArrowRight: 'RIGHT',
  w: 'UP',
  s: 'DOWN',
  a: 'LEFT',
  d: 'RIGHT',
};

/** Grid stays 20x20 everywhere (see SnakeEngine.resize) — only the cell size adapts. */
const GRID_COLS = 20;
/** Below this the snake is a smear; above it there is no point growing further. */
const MIN_CELL = 9;
const MAX_CELL = 20;
/** The canvas' own 1px border on each side. */
const BORDER = 2;

function cellSizeFor(board: HTMLElement | null): number {
  const available = board?.clientWidth ?? 0;
  if (available <= 0) return MAX_CELL;
  const fitted = Math.floor((available - BORDER) / GRID_COLS);
  return Math.max(MIN_CELL, Math.min(MAX_CELL, fitted));
}

export function NeonSnake({ onGameOver }: { onGameOver: (score: number) => void }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const boardRef = useRef<HTMLDivElement>(null);
  const engineRef = useRef<SnakeEngine | null>(null);
  const [score, setScore] = useState(0);
  const [status, setStatus] = useState<'ready' | 'playing' | 'over'>('ready');
  const [finalScore, setFinalScore] = useState(0);

  useEffect(() => {
    if (!canvasRef.current) return;
    const engine = new SnakeEngine({
      canvas: canvasRef.current,
      cellSize: cellSizeFor(boardRef.current),
      onScoreChange: setScore,
      onGameOver: (finalScoreValue) => {
        setStatus('over');
        setFinalScore(finalScoreValue);
        onGameOver(finalScoreValue);
      },
    });
    engineRef.current = engine;
    return () => engine.stop();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /**
   * The board was a hard 20 × 18px = 360px plus its border, which pushed the
   * whole page sideways on any screen narrower than ~418px — that is most
   * phones (iPhone is 390, plenty of Androids are 360). It now measures the
   * space it actually has and picks a cell size to fit, and follows the
   * container when the phone is rotated.
   */
  useEffect(() => {
    const board = boardRef.current;
    if (!board || typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(() => {
      engineRef.current?.resize(cellSizeFor(board));
    });
    observer.observe(board);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    function handleKey(e: KeyboardEvent) {
      const dir = KEY_TO_DIRECTION[e.key];
      if (dir) {
        e.preventDefault();
        engineRef.current?.setDirection(dir);
      }
    }
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, []);

  function start() {
    engineRef.current?.reset();
    setScore(0);
    setStatus('playing');
    engineRef.current?.start();
  }

  // Touch swipe controls for mobile / Telegram WebView.
  const touchStart = useRef<{ x: number; y: number } | null>(null);
  function onTouchStart(e: React.TouchEvent) {
    const t = e.touches[0];
    touchStart.current = { x: t.clientX, y: t.clientY };
  }
  function onTouchEnd(e: React.TouchEvent) {
    if (!touchStart.current) return;
    const t = e.changedTouches[0];
    const dx = t.clientX - touchStart.current.x;
    const dy = t.clientY - touchStart.current.y;
    if (Math.abs(dx) > Math.abs(dy)) {
      engineRef.current?.setDirection(dx > 0 ? 'RIGHT' : 'LEFT');
    } else {
      engineRef.current?.setDirection(dy > 0 ? 'DOWN' : 'UP');
    }
    touchStart.current = null;
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 12 }}>
      <div style={{ fontSize: 'var(--z-fs-lg)', fontWeight: 800 }}>
        Счёт: <span className="z-accent-text">{score}</span>
      </div>
      <div
        ref={boardRef}
        style={{ position: 'relative', touchAction: 'none', width: '100%', display: 'flex', justifyContent: 'center' }}
        onTouchStart={onTouchStart}
        onTouchEnd={onTouchEnd}
      >
        <canvas
          ref={canvasRef}
          style={{ borderRadius: 'var(--z-radius-md)', border: '1px solid var(--z-border)' }}
        />
        {status !== 'playing' && (
          <div
            style={{
              position: 'absolute',
              inset: 0,
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 12,
              background: 'rgba(11,14,13,0.85)',
              borderRadius: 'var(--z-radius-md)',
            }}
          >
            {status === 'over' && (
              <div style={{ fontWeight: 700 }}>Игра окончена — счёт {finalScore}</div>
            )}
            <button className="z-btn-accent" onClick={start}>
              {status === 'ready' ? 'Играть' : 'Играть снова'}
            </button>
          </div>
        )}
      </div>
      <p style={{ fontSize: 'var(--z-fs-xs)', color: 'var(--z-text-faint)' }}>
        Стрелки / WASD на клавиатуре, свайп на телефоне
      </p>
    </div>
  );
}
