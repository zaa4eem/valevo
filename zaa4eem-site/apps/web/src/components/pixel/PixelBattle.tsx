'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import {
  PIXEL_CANVAS_SIZE,
  PIXEL_CELL_COUNT,
  PIXEL_EMPTY,
  PIXEL_PALETTE,
  PIXEL_PALETTE_NAMES,
  plural,
  type PixelCell,
  type PixelState,
} from '@zaa4eem/shared';
import { api, ApiError, getApiBase } from '@/lib/api-client';
import { useAuth } from '@/lib/auth-context';
import { haptic, hapticNotify } from '@/lib/telegram';
import { useToast } from '@/lib/toast-context';
import { Avatar } from '@/components/Avatar';
import { PixelEngine } from './engine';

/** Movement past this (CSS px) makes a gesture a pan, not a tap. */
const TAP_SLOP = 6;

function formatCountdown(ms: number): string {
  const total = Math.ceil(ms / 1000);
  const minutes = Math.floor(total / 60);
  const seconds = total % 60;
  return `${minutes}:${String(seconds).padStart(2, '0')}`;
}

export function PixelBattle() {
  const { user } = useAuth();
  const { toast } = useToast();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const boxRef = useRef<HTMLDivElement>(null);
  const engineRef = useRef<PixelEngine | null>(null);

  const [ready, setReady] = useState(false);
  const [loadFailed, setLoadFailed] = useState(false);
  const [state, setState] = useState<PixelState | null>(null);
  const [remainingMs, setRemainingMs] = useState(0);
  const [color, setColor] = useState(9);
  const [selected, setSelected] = useState<{ x: number; y: number } | null>(null);
  const [cell, setCell] = useState<PixelCell | null>(null);
  const [placing, setPlacing] = useState(false);
  const [zoom, setZoom] = useState(3);

  const refreshState = useCallback(async () => {
    try {
      const next = await api.get<PixelState>('/pixel/state');
      setState(next);
      setRemainingMs(next.cooldownRemainingMs);
    } catch {
      // The canvas itself still works; the counter just stays as it was.
    }
  }, []);

  // --- Engine, snapshot, live stream -------------------------------------

  useEffect(() => {
    if (!canvasRef.current) return;
    const engine = new PixelEngine({ canvas: canvasRef.current, onViewChange: setZoom });
    engineRef.current = engine;

    const box = boxRef.current;
    if (box) engine.resize(box.clientWidth, box.clientHeight);
    engine.fit();

    let cancelled = false;
    (async () => {
      try {
        // Fetched directly rather than through the api helper: the snapshot
        // is bytes, not JSON, and going through the JSON path would only
        // mean re-encoding 62 KB for nothing.
        const res = await fetch(`${getApiBase()}/pixel/snapshot`, { credentials: 'include' });
        if (!res.ok) throw new Error(String(res.status));
        const bytes = new Uint8Array(await res.arrayBuffer());
        if (bytes.length < PIXEL_CELL_COUNT) throw new Error('snapshot too short');
        if (cancelled) return;
        engine.setSnapshot(bytes);
        engine.fit();
        setReady(true);
      } catch {
        if (!cancelled) setLoadFailed(true);
      }
    })();

    return () => {
      cancelled = true;
      engine.destroy();
      engineRef.current = null;
    };
  }, []);

  useEffect(() => {
    const box = boxRef.current;
    if (!box || typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(() => {
      engineRef.current?.resize(box.clientWidth, box.clientHeight);
    });
    observer.observe(box);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    refreshState();
  }, [refreshState, user]);

  /**
   * Live placements from everyone else.
   *
   * No auth: the canvas is public, so a signed-out visitor watches it move
   * too — which is most of the reason to open the page at all.
   */
  useEffect(() => {
    if (typeof EventSource === 'undefined') return;
    const source = new EventSource(`${getApiBase()}/pixel/stream`);
    source.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        if (typeof data.x !== 'number') return; // keepalive ping
        engineRef.current?.setCell(data.x, data.y, data.color);
        setState((current) => current && { ...current, paintedCount: current.paintedCount + 1 });
      } catch {
        // A malformed frame is not worth tearing the connection down for.
      }
    };
    return () => source.close();
  }, []);

  // The countdown ticks locally; the server value is the authority whenever
  // one arrives, so a tab left open overnight can't end up thinking it may
  // paint when it may not.
  useEffect(() => {
    if (remainingMs <= 0) return;
    const timer = setInterval(() => {
      setRemainingMs((current) => Math.max(0, current - 1000));
    }, 1000);
    return () => clearInterval(timer);
  }, [remainingMs > 0]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    engineRef.current?.setPreview(selected ? color : null);
  }, [color, selected]);

  // --- Gestures ----------------------------------------------------------

  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const gesture = useRef<{ moved: number; lastPinch: number | null }>({ moved: 0, lastPinch: null });

  function localPoint(e: React.PointerEvent) {
    const rect = e.currentTarget.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  }

  function onPointerDown(e: React.PointerEvent<HTMLCanvasElement>) {
    e.currentTarget.setPointerCapture(e.pointerId);
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pointers.current.size === 1) gesture.current = { moved: 0, lastPinch: null };
  }

  function onPointerMove(e: React.PointerEvent<HTMLCanvasElement>) {
    const previous = pointers.current.get(e.pointerId);
    if (!previous) return;
    const next = { x: e.clientX, y: e.clientY };
    pointers.current.set(e.pointerId, next);

    const engine = engineRef.current;
    if (!engine) return;

    if (pointers.current.size >= 2) {
      const [a, b] = [...pointers.current.values()];
      const distance = Math.hypot(a.x - b.x, a.y - b.y);
      const rect = e.currentTarget.getBoundingClientRect();
      const centre = { x: (a.x + b.x) / 2 - rect.left, y: (a.y + b.y) / 2 - rect.top };
      if (gesture.current.lastPinch !== null && gesture.current.lastPinch > 0) {
        engine.zoomAt(centre, distance / gesture.current.lastPinch);
      }
      gesture.current.lastPinch = distance;
      // A pinch is never a tap, however little the fingers moved.
      gesture.current.moved = TAP_SLOP + 1;
      return;
    }

    const dx = next.x - previous.x;
    const dy = next.y - previous.y;
    gesture.current.moved += Math.hypot(dx, dy);
    engine.panBy(dx, dy);
  }

  function onPointerUp(e: React.PointerEvent<HTMLCanvasElement>) {
    const wasSingle = pointers.current.size === 1;
    pointers.current.delete(e.pointerId);
    if (pointers.current.size < 2) gesture.current.lastPinch = null;

    // A tap selects; it never paints. Committing on the first tap would mean
    // a 30-minute cooldown spent by a slipped finger, which is the one
    // mistake this design must not allow.
    if (!wasSingle || gesture.current.moved > TAP_SLOP) return;
    const hit = engineRef.current?.cellAt(localPoint(e)) ?? null;
    if (!hit) return;
    haptic('light');
    selectCell(hit);
  }

  function onWheel(e: React.WheelEvent<HTMLCanvasElement>) {
    const rect = e.currentTarget.getBoundingClientRect();
    engineRef.current?.zoomAt(
      { x: e.clientX - rect.left, y: e.clientY - rect.top },
      e.deltaY < 0 ? 1.15 : 1 / 1.15,
    );
  }

  const selectCell = useCallback((next: { x: number; y: number }) => {
    engineRef.current?.select(next);
    setSelected(next);
    setCell(null);
    api
      .get<PixelCell>(`/pixel/cell/${next.x}/${next.y}`)
      .then(setCell)
      .catch(() => setCell(null));
  }, []);

  function clearSelection() {
    engineRef.current?.select(null);
    setSelected(null);
    setCell(null);
  }

  // --- Placing -----------------------------------------------------------

  async function place() {
    if (!selected || placing) return;
    setPlacing(true);
    try {
      await api.post('/pixel', { x: selected.x, y: selected.y, color });
      engineRef.current?.setCell(selected.x, selected.y, color);
      hapticNotify('success');
      clearSelection();
      await refreshState();
    } catch (err) {
      hapticNotify('error');
      toast(err instanceof ApiError ? err.message : 'Не удалось поставить пиксель', 'error');
      // Whatever the reason, the server knows the truth about the cooldown —
      // re-reading it also repairs a client whose countdown has drifted.
      await refreshState();
    } finally {
      setPlacing(false);
    }
  }

  const canPaint = Boolean(user) && remainingMs <= 0;
  const filledPercent = state ? Math.round((state.paintedCount / PIXEL_CELL_COUNT) * 1000) / 10 : 0;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div
        style={{
          display: 'flex',
          flexWrap: 'wrap',
          gap: 10,
          alignItems: 'center',
          fontSize: 'var(--z-fs-xs)',
          color: 'var(--z-text-muted)',
        }}
      >
        <span className="z-badge" style={{ background: 'var(--z-accent-soft)', color: 'var(--z-accent)' }}>
          {PIXEL_CANVAS_SIZE}×{PIXEL_CANVAS_SIZE}
        </span>
        {state && (
          <>
            <span>Закрашено {filledPercent}%</span>
            <span>
              {state.activePainters} {plural(state.activePainters, 'художник', 'художника', 'художников')} за сутки
            </span>
          </>
        )}
        <button
          type="button"
          onClick={() => engineRef.current?.fit()}
          className="z-btn-ghost z-pop-on-active"
          style={{ marginLeft: 'auto', fontSize: 'var(--z-fs-xs)', padding: '4px 10px' }}
        >
          Весь холст
        </button>
      </div>

      <div
        ref={boxRef}
        style={{
          position: 'relative',
          width: '100%',
          height: 'min(70vh, 520px)',
          borderRadius: 'var(--z-radius-md)',
          overflow: 'hidden',
          border: '1px solid var(--z-border)',
          background: '#080a09',
        }}
      >
        <canvas
          ref={canvasRef}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerUp}
          onWheel={onWheel}
          // touchAction none, or the browser scrolls the page instead of
          // letting the canvas pan.
          style={{ touchAction: 'none', display: 'block', cursor: 'crosshair' }}
        />
        {!ready && (
          <div
            style={{
              position: 'absolute',
              inset: 0,
              display: 'grid',
              placeItems: 'center',
              color: 'var(--z-text-faint)',
              fontSize: 'var(--z-fs-sm)',
            }}
          >
            {loadFailed ? 'Не удалось загрузить холст — обновите страницу.' : 'Загружаем холст…'}
          </div>
        )}
        {ready && (
          <div
            style={{
              position: 'absolute',
              left: 10,
              bottom: 10,
              fontSize: 'var(--z-fs-xs)',
              color: 'var(--z-text-faint)',
              background: 'rgba(8,10,9,0.7)',
              borderRadius: 999,
              padding: '3px 10px',
              pointerEvents: 'none',
            }}
          >
            ×{zoom < 1 ? zoom.toFixed(1) : Math.round(zoom)}
          </div>
        )}
      </div>

      <PalettePicker color={color} onChange={setColor} disabled={!user} />

      {!user ? (
        <div
          style={{
            border: '1px solid var(--z-border)',
            borderRadius: 'var(--z-radius-md)',
            padding: 14,
            textAlign: 'center',
          }}
        >
          <p style={{ margin: '0 0 10px', color: 'var(--z-text-muted)', fontSize: 'var(--z-fs-sm)' }}>
            Смотреть можно без аккаунта — рисовать нет.
          </p>
          <Link href="/login" className="z-btn-accent z-pop-on-active">
            Войти и рисовать
          </Link>
        </div>
      ) : selected ? (
        <SelectedCell
          x={selected.x}
          y={selected.y}
          cell={cell}
          color={color}
          canPaint={canPaint}
          remainingMs={remainingMs}
          placing={placing}
          onPlace={place}
          onCancel={clearSelection}
        />
      ) : (
        <p
          style={{
            margin: 0,
            fontSize: 'var(--z-fs-sm)',
            color: 'var(--z-text-faint)',
            textAlign: 'center',
          }}
        >
          {remainingMs > 0
            ? `Следующий пиксель через ${formatCountdown(remainingMs)}`
            : 'Нажми на клетку, чтобы выбрать её'}
        </p>
      )}

      <p style={{ margin: 0, fontSize: 'var(--z-fs-xs)', color: 'var(--z-text-faint)', textAlign: 'center' }}>
        Тащи, чтобы двигать холст · колесо или щипок, чтобы приблизить
      </p>
    </div>
  );
}

function PalettePicker({
  color,
  onChange,
  disabled,
}: {
  color: number;
  onChange: (color: number) => void;
  disabled: boolean;
}) {
  return (
    <div
      role="radiogroup"
      aria-label="Цвет"
      style={{ display: 'flex', flexWrap: 'wrap', gap: 6, justifyContent: 'center' }}
    >
      {/* Index 0 is the empty cell and is deliberately absent: it is not a
          colour you may paint, it is the absence of one. */}
      {PIXEL_PALETTE.map((hex, index) =>
        index === PIXEL_EMPTY ? null : (
          <button
            key={hex}
            type="button"
            role="radio"
            aria-checked={color === index}
            aria-label={PIXEL_PALETTE_NAMES[index]}
            title={PIXEL_PALETTE_NAMES[index]}
            disabled={disabled}
            onClick={() => onChange(index)}
            className="z-pop-on-active"
            style={{
              width: 32,
              height: 32,
              borderRadius: 'var(--z-radius-sm)',
              background: hex,
              cursor: disabled ? 'default' : 'pointer',
              opacity: disabled ? 0.45 : 1,
              // The chosen swatch is lifted out of the row rather than just
              // outlined — an outline on a dark swatch is invisible.
              border: color === index ? '2px solid var(--z-text)' : '1px solid rgba(255,255,255,0.15)',
              transform: color === index ? 'translateY(-3px)' : 'none',
              boxShadow: color === index ? '0 4px 10px rgba(0,0,0,0.45)' : 'none',
              transition: 'transform 120ms ease',
            }}
          />
        ),
      )}
    </div>
  );
}

function SelectedCell({
  x,
  y,
  cell,
  color,
  canPaint,
  remainingMs,
  placing,
  onPlace,
  onCancel,
}: {
  x: number;
  y: number;
  cell: PixelCell | null;
  color: number;
  canPaint: boolean;
  remainingMs: number;
  placing: boolean;
  onPlace: () => void;
  onCancel: () => void;
}) {
  const last = cell?.history[0];

  return (
    <div
      className="z-animate-in"
      style={{
        border: '1px solid var(--z-border)',
        borderRadius: 'var(--z-radius-md)',
        padding: 12,
        display: 'flex',
        flexDirection: 'column',
        gap: 10,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
        <span
          style={{
            width: 26,
            height: 26,
            borderRadius: 'var(--z-radius-sm)',
            background: PIXEL_PALETTE[color],
            border: '1px solid rgba(255,255,255,0.2)',
            flexShrink: 0,
          }}
        />
        <div style={{ fontWeight: 700 }}>
          ({x}, {y})
        </div>
        <button
          type="button"
          onClick={onCancel}
          className="z-btn-ghost z-pop-on-active"
          style={{ marginLeft: 'auto', fontSize: 'var(--z-fs-xs)', padding: '4px 10px' }}
        >
          Отмена
        </button>
      </div>

      {/* Who painted it last, so the canvas reads as people rather than as
          a picture that changes by itself. */}
      {last ? (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 'var(--z-fs-xs)' }}>
          <Avatar name={last.user.displayName} avatarUrl={last.user.avatarUrl} size={22} />
          <Link href={`/u/${last.user.id}`} style={{ fontWeight: 700 }}>
            {last.user.displayName}
          </Link>
          <span style={{ color: 'var(--z-text-faint)' }}>
            {new Date(last.createdAt).toLocaleString('ru-RU', {
              day: 'numeric',
              month: 'short',
              hour: '2-digit',
              minute: '2-digit',
            })}
          </span>
          {cell && cell.history.length > 1 && (
            <span style={{ color: 'var(--z-text-faint)', marginLeft: 'auto' }}>
              до этого — {cell.history.length - 1}
            </span>
          )}
        </div>
      ) : (
        <div style={{ fontSize: 'var(--z-fs-xs)', color: 'var(--z-text-faint)' }}>
          {cell === null ? 'Смотрим, кто тут был…' : 'Эту клетку ещё никто не трогал'}
        </div>
      )}

      {/* Faded-out accent green still reads as "press me". While the
          cooldown runs this is not a button you can press, so it stops
          looking like the primary action and becomes a label that happens
          to be a button. */}
      <button
        type="button"
        onClick={onPlace}
        disabled={!canPaint || placing}
        className={canPaint ? 'z-btn-accent z-pop-on-active' : 'z-btn-ghost'}
        style={{
          opacity: placing ? 0.6 : 1,
          cursor: canPaint && !placing ? 'pointer' : 'default',
          fontVariantNumeric: 'tabular-nums',
        }}
      >
        {placing
          ? 'Ставим…'
          : canPaint
            ? 'Поставить пиксель'
            : `Следующий пиксель через ${formatCountdown(remainingMs)}`}
      </button>
    </div>
  );
}
