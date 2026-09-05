'use client';

import Link from 'next/link';
import { useProgress } from '@/lib/progress-context';

/**
 * The navbar's one-glance state: current level, and the streak flame.
 *
 * The flame goes cold (grey, no glow) when today's visit hasn't been counted
 * yet — that unlit flame is the whole point of putting it here, because it
 * is the only thing on screen that says "you have not been here today".
 */
export function LevelStreakBadge() {
  const { state } = useProgress();
  if (!state) return null;

  const { level } = state.level;
  const { days, countedToday } = state.streak;

  return (
    <Link
      href="/progress"
      className="z-level-badge z-pop-on-active"
      title={`Уровень ${level}${days > 0 ? ` · серия ${days} дн.` : ''}`}
    >
      <span className="z-level-badge-num">{level}</span>
      {days > 0 && (
        <span className={`z-streak-flame${countedToday ? ' z-streak-flame-lit' : ''}`}>
          🔥{days}
        </span>
      )}
    </Link>
  );
}
