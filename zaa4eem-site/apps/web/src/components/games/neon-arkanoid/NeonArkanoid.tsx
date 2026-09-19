'use client';

import { useEffect, useRef, useState } from 'react';
import { ArkanoidEngine } from './engine';

/** Keeps the board from swallowing a desktop screen; phones use the full width. */
const MAX_BOARD_WIDTH = 420;

export function NeonArkanoid({ onGameOver }: { onGameOver: (score: number) => void }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const boardRef = useRef<HTMLDivElement>(null);
  const engineRef = useRef<ArkanoidEngine | null>(null);

  const [score, setScore] = useState(0);
  const [lives, setLives] = useState(3);
  const [level, setLevel] = useState(1);
  const [status, setStatus] = useState<'ready' | 'playing' | 'over'>('ready');
  const [finalScore, setFinalScore] = useState(0);

  /**
   * The engine is built once and keeps whatever callback it was handed, so
   * it must not be handed a closure straight from render: on a cold page
   * load the auth context is usually still resolving at that moment, and
   * the captured onGameOver would go on believing nobody is signed in —
   * silently dropping every score the player earns for the rest of the
   * session. The ref is always the current one.
   */
  const onGameOverRef = useRef(onGameOver);
  useEffect(() => {
    onGameOverRef.current = onGameOver;
  });

  useEffect(() => {
    if (!canvasRef.current) return;
    const engine = new ArkanoidEngine({
      canvas: canvasRef.current,
      onScoreChange: setScore,
      onLivesChange: setLives,
      onLevelChange: setLevel,
      onGameOver: (value) => {
        setStatus('over');
        setFinalScore(value);
        onGameOverRef.current(value);
      },
    });
    engineRef.current = engine;
    engine.resize(boardWidth(boardRef.current));
    return () => engine.stop();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /** Follows the container, so rotating the phone re-fits the board instead of overflowing it. */
  useEffect(() => {
    const board = boardRef.current;
    if (!board || typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(() => {
      engineRef.current?.resize(boardWidth(board));
    });
    observer.observe(board);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    function handleKey(e: KeyboardEvent) {
      const engine = engineRef.current;
      if (!engine) return;
      if (e.key === 'ArrowLeft' || e.key === 'a') {
        e.preventDefault();
        engine.nudgePaddle(-6);
      } else if (e.key === 'ArrowRight' || e.key === 'd') {
        e.preventDefault();
        engine.nudgePaddle(6);
      } else if (e.key === ' ') {
        e.preventDefault();
        engine.launch();
      }
    }
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, []);

  function start() {
    engineRef.current?.reset();
    setScore(0);
    setLives(3);
    setLevel(1);
    setStatus('playing');
    engineRef.current?.start();
  }

  /**
   * The paddle follows the finger directly rather than being dragged.
   *
   * On a phone the finger covers the paddle, so "grab and drag" means
   * playing blind; jumping straight to the touched position is both easier
   * to aim and the convention every touch version of this game uses.
   */
  function onPointerMove(e: React.PointerEvent<HTMLCanvasElement>) {
    if (e.pointerType === 'mouse' && e.buttons === 0 && status !== 'playing') return;
    const rect = e.currentTarget.getBoundingClientRect();
    engineRef.current?.movePaddleTo(engineRef.current.toLogicalX(e.clientX - rect.left));
  }

  function onPointerDown(e: React.PointerEvent<HTMLCanvasElement>) {
    e.currentTarget.setPointerCapture(e.pointerId);
    const rect = e.currentTarget.getBoundingClientRect();
    const engine = engineRef.current;
    if (!engine) return;
    engine.movePaddleTo(engine.toLogicalX(e.clientX - rect.left));
    engine.launch();
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 12 }}>
      <div
        style={{
          display: 'flex',
          gap: 16,
          fontSize: 'var(--z-fs-sm)',
          fontWeight: 700,
          fontVariantNumeric: 'tabular-nums',
        }}
      >
        <span>
          Счёт: <span className="z-accent-text">{score}</span>
        </span>
        <span>Уровень {level}</span>
        <span aria-label={`Жизней: ${lives}`}>{'❤️'.repeat(Math.max(0, lives))}</span>
      </div>

      <div
        ref={boardRef}
        style={{ position: 'relative', width: '100%', display: 'flex', justifyContent: 'center' }}
      >
        <canvas
          ref={canvasRef}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          style={{
            borderRadius: 'var(--z-radius-md)',
            border: '1px solid var(--z-border)',
            // Or the browser scrolls the page while the finger is steering.
            touchAction: 'none',
            display: 'block',
          }}
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
            {status === 'over' && <div style={{ fontWeight: 700 }}>Игра окончена — счёт {finalScore}</div>}
            <button className="z-btn-accent" onClick={start}>
              {status === 'ready' ? 'Играть' : 'Играть снова'}
            </button>
          </div>
        )}
      </div>

      <p style={{ fontSize: 'var(--z-fs-xs)', color: 'var(--z-text-faint)', margin: 0, textAlign: 'center' }}>
        Веди пальцем или мышью · нажми, чтобы запустить шар · стрелки и пробел на клавиатуре
      </p>
    </div>
  );
}

function boardWidth(board: HTMLElement | null): number {
  const available = board?.clientWidth ?? 0;
  if (available <= 0) return MAX_BOARD_WIDTH;
  // The canvas' own 1px border on each side.
  return Math.min(MAX_BOARD_WIDTH, available - 2);
}
