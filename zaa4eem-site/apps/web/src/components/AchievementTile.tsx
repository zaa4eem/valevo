'use client';

import type { AchievementState } from '@zaa4eem/shared';
import { TiltCard } from './TiltCard';

/**
 * A locked tile still shows its icon and how far along you are — hiding the
 * target turns a collection into a guessing game, and the progress number is
 * the thing that makes someone go do one more.
 */
export function AchievementTile({ achievement }: { achievement: AchievementState }) {
  const { unlocked, progress, threshold } = achievement;
  return (
    // Tilt only on an unlocked tile: a locked one is a target, not a thing
    // you own, and giving it the same physicality muddles that.
    <TiltCard
      className={`z-achievement z-tier-${achievement.tier.toLowerCase()}${unlocked ? ' z-achievement-unlocked' : ''}`}
      maxTilt={unlocked ? 8 : 0}
      title={achievement.description}
    >
      <span className="z-achievement-icon" aria-hidden>
        {achievement.icon}
      </span>
      <span className="z-achievement-title">{achievement.title}</span>
      <span className="z-achievement-desc">{achievement.description}</span>
      {unlocked ? (
        <span className="z-achievement-meta">+{achievement.xp} XP</span>
      ) : (
        <>
          <span className="z-xp-track" style={{ height: 4 }}>
            <span
              className="z-xp-fill"
              style={{ display: 'block', height: '100%', width: `${Math.max(2, (progress / threshold) * 100)}%` }}
            />
          </span>
          <span className="z-achievement-meta" style={{ fontVariantNumeric: 'tabular-nums' }}>
            {progress} / {threshold}
          </span>
        </>
      )}
    </TiltCard>
  );
}
