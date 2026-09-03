import type { CSSProperties } from 'react';

/**
 * A pulsing placeholder block — the base building block for skeleton
 * loaders. Cycles between `--z-surface-hover` and `--z-border` (see the
 * `z-skeleton-pulse` keyframes in tokens.css), so it looks right in both
 * themes without any hardcoded colors.
 */
export function Skeleton({
  width = '100%',
  height = 16,
  radius = 'var(--z-radius-sm)',
  className = '',
  style,
}: {
  width?: number | string;
  height?: number | string;
  radius?: number | string;
  className?: string;
  style?: CSSProperties;
}) {
  return (
    <div
      className={`z-skeleton ${className}`.trim()}
      style={{ width, height, borderRadius: radius, ...style }}
    />
  );
}

/** A single line of skeleton text — a short, pill-shaped bar. */
export function SkeletonText({
  width = '100%',
  height = 14,
  style,
}: {
  width?: number | string;
  height?: number;
  style?: CSSProperties;
}) {
  return <Skeleton width={width} height={height} radius={999} style={style} />;
}

/** A round skeleton — stands in for an avatar while data loads. */
export function SkeletonCircle({ size = 40 }: { size?: number }) {
  return <Skeleton width={size} height={size} radius="50%" />;
}

/**
 * A full card-shaped skeleton: a title line, a handful of body lines, and
 * an optional avatar — enough to stand in for a `Card` while its real
 * content is still loading.
 */
export function SkeletonCard({
  lines = 2,
  avatar = false,
  style,
}: {
  lines?: number;
  avatar?: boolean;
  style?: CSSProperties;
}) {
  return (
    <div className="z-card" style={style}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 14 }}>
        {avatar && <SkeletonCircle size={40} />}
        <SkeletonText width="45%" height={18} />
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {Array.from({ length: lines }).map((_, i) => (
          <SkeletonText key={i} width={i === lines - 1 ? '65%' : '100%'} />
        ))}
      </div>
    </div>
  );
}
