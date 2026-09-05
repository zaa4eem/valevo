'use client';

import type { LevelState } from '@zaa4eem/shared';

/** The level bar, reused on the progress page and the public profile. */
export function LevelBar({ level, compact = false }: { level: LevelState; compact?: boolean }) {
  const atMax = level.xpForNextLevel === 0;
  return (
    <div style={{ width: '100%' }}>
      <div
        style={{
          display: 'flex',
          alignItems: 'baseline',
          justifyContent: 'space-between',
          gap: 10,
          marginBottom: 6,
        }}
      >
        <span style={{ fontWeight: 800, fontSize: compact ? 'var(--z-fs-sm)' : 'var(--z-fs-lg)' }}>
          Уровень {level.level}
        </span>
        <span
          style={{
            fontSize: 'var(--z-fs-xs)',
            color: 'var(--z-text-muted)',
            fontVariantNumeric: 'tabular-nums',
          }}
        >
          {atMax
            ? `${level.xp.toLocaleString('ru-RU')} XP · максимум`
            : `${level.xpIntoLevel.toLocaleString('ru-RU')} / ${level.xpForNextLevel.toLocaleString('ru-RU')} XP`}
        </span>
      </div>
      <div className="z-xp-track" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(level.fraction * 100)}>
        <div className="z-xp-fill" style={{ width: `${Math.max(2, level.fraction * 100)}%` }} />
      </div>
    </div>
  );
}
