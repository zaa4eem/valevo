'use client';

import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import { BANNER_OUTPUT_HEIGHT, BANNER_OUTPUT_WIDTH } from '@zaa4eem/shared';

// Same 3:1 ratio as the output — matches AvatarCropper's approach, just
// rectangular instead of square, so the wide viewport IS the crop area
// (no separate circular-mask overlay needed, unlike the avatar's round crop).
const VIEWPORT_W = 360;
const VIEWPORT_H = Math.round((VIEWPORT_W * BANNER_OUTPUT_HEIGHT) / BANNER_OUTPUT_WIDTH);
const MAX_ZOOM = 3;

type Point = { x: number; y: number };
type Size = { w: number; h: number };

function clampPosition(pos: Point, dispSize: Size): Point {
  const minX = VIEWPORT_W - dispSize.w;
  const minY = VIEWPORT_H - dispSize.h;
  return {
    x: Math.min(0, Math.max(minX, pos.x)),
    y: Math.min(0, Math.max(minY, pos.y)),
  };
}

/** Modal: lets the user pan/zoom a just-picked image before it's uploaded as a profile banner — same pattern as AvatarCropper, but a wide 3:1 rectangle instead of a square. */
export function BannerCropper({
  file,
  onCancel,
  onCropped,
  onCroppedGif,
}: {
  file: File;
  onCancel: () => void;
  onCropped: (blob: Blob) => void;
  /** See AvatarCropper's onCroppedGif — same reasoning: gifsicle re-crops every frame server-side instead of a <canvas> draw killing the animation. */
  onCroppedGif: (file: File, crop: { x: number; y: number; width: number; height: number }) => void;
}) {
  const isGif = file.type === 'image/gif';
  const [imgUrl, setImgUrl] = useState<string | null>(null);
  const imgRef = useRef<HTMLImageElement | null>(null);
  const [natural, setNatural] = useState<Size | null>(null);
  const [zoom, setZoom] = useState(1);
  const [pos, setPos] = useState<Point>({ x: 0, y: 0 });
  const dragRef = useRef<{ startX: number; startY: number; pos: Point } | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const url = URL.createObjectURL(file);
    setImgUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [file]);

  function onImgLoad() {
    const img = imgRef.current;
    if (!img) return;
    const w = img.naturalWidth;
    const h = img.naturalHeight;
    setNatural({ w, h });
    const base = Math.max(VIEWPORT_W / w, VIEWPORT_H / h);
    setZoom(1);
    setPos({ x: (VIEWPORT_W - w * base) / 2, y: (VIEWPORT_H - h * base) / 2 });
  }

  const baseScale = natural ? Math.max(VIEWPORT_W / natural.w, VIEWPORT_H / natural.h) : 1;
  const scale = baseScale * zoom;
  const dispSize: Size = natural ? { w: natural.w * scale, h: natural.h * scale } : { w: 0, h: 0 };

  function onPointerDown(e: ReactPointerEvent<HTMLDivElement>) {
    e.currentTarget.setPointerCapture(e.pointerId);
    dragRef.current = { startX: e.clientX, startY: e.clientY, pos };
  }

  function onPointerMove(e: ReactPointerEvent<HTMLDivElement>) {
    if (!dragRef.current) return;
    const dx = e.clientX - dragRef.current.startX;
    const dy = e.clientY - dragRef.current.startY;
    setPos(clampPosition({ x: dragRef.current.pos.x + dx, y: dragRef.current.pos.y + dy }, dispSize));
  }

  function onPointerUp() {
    dragRef.current = null;
  }

  function onZoomChange(nextZoom: number) {
    if (!natural) return;
    const cx = (VIEWPORT_W / 2 - pos.x) / scale;
    const cy = (VIEWPORT_H / 2 - pos.y) / scale;
    const newScale = baseScale * nextZoom;
    const newDispSize: Size = { w: natural.w * newScale, h: natural.h * newScale };
    setZoom(nextZoom);
    setPos(
      clampPosition({ x: VIEWPORT_W / 2 - cx * newScale, y: VIEWPORT_H / 2 - cy * newScale }, newDispSize),
    );
  }

  async function confirm() {
    if (!imgRef.current || !natural) return;
    setBusy(true);
    try {
      const sWidth = VIEWPORT_W / scale;
      const sHeight = VIEWPORT_H / scale;
      const sourceX = -pos.x / scale;
      const sourceY = -pos.y / scale;

      if (isGif) {
        onCroppedGif(file, { x: sourceX, y: sourceY, width: sWidth, height: sHeight });
        return;
      }

      const canvas = document.createElement('canvas');
      canvas.width = BANNER_OUTPUT_WIDTH;
      canvas.height = BANNER_OUTPUT_HEIGHT;
      const ctx = canvas.getContext('2d');
      if (!ctx) return;
      ctx.drawImage(imgRef.current, sourceX, sourceY, sWidth, sHeight, 0, 0, BANNER_OUTPUT_WIDTH, BANNER_OUTPUT_HEIGHT);
      const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.9));
      if (blob) onCropped(blob);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(0, 0, 0, 0.6)',
        display: 'grid',
        placeItems: 'center',
        zIndex: 1000,
        padding: 16,
      }}
      onClick={onCancel}
    >
      <div
        className="z-card"
        style={{ width: 'min(420px, 100%)', display: 'flex', flexDirection: 'column', gap: 16 }}
        onClick={(e) => e.stopPropagation()}
      >
        <h3 style={{ margin: 0, fontSize: 'var(--z-fs-lg)' }}>
          {isGif ? 'Обрезать GIF-баннер' : 'Обрезать баннер'}
        </h3>

        <div
          style={{
            position: 'relative',
            width: VIEWPORT_W,
            height: VIEWPORT_H,
            margin: '0 auto',
            borderRadius: 'var(--z-radius-md)',
            overflow: 'hidden',
            background: 'var(--z-bg)',
            touchAction: 'none',
            cursor: 'grab',
          }}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerLeave={onPointerUp}
        >
          {imgUrl && (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              ref={imgRef}
              src={imgUrl}
              alt=""
              draggable={false}
              onLoad={onImgLoad}
              style={{
                position: 'absolute',
                left: pos.x,
                top: pos.y,
                width: dispSize.w || undefined,
                height: dispSize.h || undefined,
                maxWidth: 'none',
                userSelect: 'none',
                pointerEvents: 'none',
              }}
            />
          )}
        </div>

        <label style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <span style={{ fontSize: 'var(--z-fs-sm)' }}>🔍</span>
          <input
            type="range"
            min={1}
            max={MAX_ZOOM}
            step={0.01}
            value={zoom}
            onChange={(e) => onZoomChange(Number(e.target.value))}
            style={{ flex: 1 }}
            disabled={!natural}
          />
        </label>

        <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
          <button className="z-btn-ghost z-pop-on-active" onClick={onCancel} disabled={busy}>
            Отмена
          </button>
          <button className="z-btn-accent z-pop-on-active" onClick={confirm} disabled={busy || !natural}>
            {busy ? 'Сохранение…' : 'Сохранить'}
          </button>
        </div>
      </div>
    </div>
  );
}
