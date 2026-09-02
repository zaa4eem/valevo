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

export function NeonSnake({ onGameOver }: { onGameOver: (score: number) => void }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const engineRef = useRef<SnakeEngine | null>(null);
  const [score, setScore] = useState(0);
  const [status, setStatus] = useState<'ready' | 'playing' | 'over'>('ready');
  const [finalScore, setFinalScore] = useState(0);

  useEffect(() => {
    if (!canvasRef.current) return;
    const engine = new SnakeEngine({
      canvas: canvasRef.current,
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
        style={{ position: 'relative', touchAction: 'none' }}
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
