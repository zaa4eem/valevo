'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import type { AchievementState } from '@zaa4eem/shared';
import { ACHIEVEMENT_GROUPS } from '@zaa4eem/shared';
import { api } from '@/lib/api-client';
import { useAuth } from '@/lib/auth-context';
import { Card } from '@/components/Card';
import { AchievementTile } from '@/components/AchievementTile';

export default function AchievementsPage() {
  const { user, loading: authLoading } = useAuth();
  const [items, setItems] = useState<AchievementState[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [onlyUnlocked, setOnlyUnlocked] = useState(false);

  useEffect(() => {
    if (!user) return;
    let cancelled = false;
    api
      .get<AchievementState[]>('/progress/achievements')
      .then((value) => {
        if (!cancelled) setItems(value);
      })
      .catch(() => {
        if (!cancelled) setError('Не удалось загрузить достижения');
      });
    return () => {
      cancelled = true;
    };
  }, [user]);

  if (authLoading) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        {[0, 1, 2].map((i) => (
          <span key={i} className="z-skeleton" style={{ height: 140, borderRadius: 'var(--z-radius-md)' }} />
        ))}
      </div>
    );
  }

  if (!user) {
    return (
      <Card className="z-animate-in" style={{ textAlign: 'center', padding: '40px 20px' }}>
        <div style={{ fontSize: 40, marginBottom: 12 }}>🏅</div>
        <h1 style={{ marginTop: 0, fontSize: 'var(--z-fs-lg)' }}>Достижения</h1>
        <p style={{ color: 'var(--z-text-muted)', fontSize: 'var(--z-fs-sm)' }}>
          Войдите, чтобы собирать коллекцию.
        </p>
        <Link href="/login" className="z-btn-accent z-pop-on-active" style={{ display: 'inline-block', marginTop: 8 }}>
          Войти
        </Link>
      </Card>
    );
  }

  const unlocked = items?.filter((a) => a.unlocked).length ?? 0;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
        <div>
          <h1 style={{ margin: 0, fontSize: 'var(--z-fs-xl)' }}>Достижения</h1>
          {items && (
            <div style={{ color: 'var(--z-text-muted)', fontSize: 'var(--z-fs-sm)' }}>
              Собрано {unlocked} из {items.length}
            </div>
          )}
        </div>
        <Link href="/progress" className="z-btn-ghost z-pop-on-active">
          ← Прогресс
        </Link>
      </div>

      {/* Deliberately no "Топ-1" tile here: first place moves to whoever
          plays better today, so it lives on the profile as a live plate
          instead of being frozen into a permanent collection. */}
      <div className="z-chip-row">
        <button
          onClick={() => setOnlyUnlocked(false)}
          className={`z-chip z-pop-on-active${onlyUnlocked ? '' : ' z-chip-active'}`}
        >
          Все
        </button>
        <button
          onClick={() => setOnlyUnlocked(true)}
          className={`z-chip z-pop-on-active${onlyUnlocked ? ' z-chip-active' : ''}`}
        >
          ✓ Полученные
        </button>
      </div>

      {error && <Card style={{ borderColor: 'var(--z-danger)', color: 'var(--z-danger)' }}>{error}</Card>}

      {!items && !error && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {[0, 1, 2].map((i) => (
            <span key={i} className="z-skeleton" style={{ height: 160, borderRadius: 'var(--z-radius-md)' }} />
          ))}
        </div>
      )}

      {items &&
        ACHIEVEMENT_GROUPS.map((group) => {
          const inGroup = items.filter(
            (a) => a.group === group && (!onlyUnlocked || a.unlocked),
          );
          if (inGroup.length === 0) return null;
          return (
            <Card key={group} hover className="z-animate-in">
              <h2 style={{ marginTop: 0, marginBottom: 12, fontSize: 'var(--z-fs-lg)' }}>{group}</h2>
              <div className="z-achievement-grid">
                {inGroup.map((achievement) => (
                  <AchievementTile key={achievement.code} achievement={achievement} />
                ))}
              </div>
            </Card>
          );
        })}
    </div>
  );
}
