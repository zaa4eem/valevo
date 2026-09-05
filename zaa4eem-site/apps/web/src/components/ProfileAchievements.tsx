'use client';

import { useEffect, useState } from 'react';
import type { AchievementTier } from '@zaa4eem/shared';
import { api } from '@/lib/api-client';
import { Card } from './Card';

interface PublicAchievement {
  code: string;
  title: string;
  description: string;
  icon: string;
  tier: AchievementTier;
  group: string;
  unlockedAt: string;
}

/**
 * The collection strip on a public profile — unlocked only. Someone else's
 * page is not the place to advertise what they haven't done yet.
 */
export function ProfileAchievements({ userId }: { userId: string }) {
  const [items, setItems] = useState<PublicAchievement[] | null>(null);

  useEffect(() => {
    let cancelled = false;
    api
      .get<PublicAchievement[]>(`/progress/achievements/${userId}`)
      .then((value) => {
        if (!cancelled) setItems(value);
      })
      .catch(() => {
        if (!cancelled) setItems([]);
      });
    return () => {
      cancelled = true;
    };
  }, [userId]);

  if (!items || items.length === 0) return null;

  return (
    <Card hover className="z-animate-in" style={{ marginTop: 16 }}>
      <h2 style={{ marginTop: 0, marginBottom: 12, fontSize: 'var(--z-fs-lg)' }}>
        🏅 Достижения <span style={{ color: 'var(--z-text-faint)', fontWeight: 400 }}>({items.length})</span>
      </h2>
      <div className="z-achievement-strip">
        {items.map((achievement) => (
          <span
            key={achievement.code}
            className={`z-achievement-chip z-tier-${achievement.tier.toLowerCase()}`}
            title={`${achievement.title} — ${achievement.description}`}
          >
            <span aria-hidden>{achievement.icon}</span> {achievement.title}
          </span>
        ))}
      </div>
    </Card>
  );
}
