'use client';

import type { LeaderboardEntry } from '@zaa4eem/shared';
import { useApiData } from '@/lib/use-api-data';
import { Card } from '@/components/Card';
import { Leaderboard } from '@/components/Leaderboard';
import { SkeletonCard } from '@/components/Skeleton';

export default function GlobalLeaderboardPage() {
  const { data: entries, error } = useApiData<LeaderboardEntry[]>('/leaderboard/global');

  return (
    <div style={{ maxWidth: 480, margin: '0 auto' }}>
      <Card
        className="z-animate-in"
        style={{
          marginBottom: 20,
          background: 'linear-gradient(135deg, var(--z-surface) 0%, var(--z-accent-soft) 140%)',
        }}
      >
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            fontSize: 'var(--z-fs-xs)',
            color: 'var(--z-accent)',
            fontWeight: 700,
            textTransform: 'uppercase',
            letterSpacing: '0.06em',
            marginBottom: 6,
          }}
        >
          <span
            style={{
              width: 8,
              height: 8,
              borderRadius: '50%',
              background: 'var(--z-accent)',
              boxShadow: '0 0 0 4px var(--z-accent-soft)',
            }}
          />
          Лидерборд
        </div>
        <h1 style={{ fontSize: 'var(--z-fs-3xl)', margin: 0, fontWeight: 900, lineHeight: 1.05 }}>
          Топ <span className="z-accent-text">игроков</span>
        </h1>
        <p style={{ color: 'var(--z-text-muted)', margin: '8px 0 0', fontSize: 'var(--z-fs-sm)' }}>
          Суммарный счёт по всем мини-играм. 🎮
        </p>
      </Card>

      {error ? (
        <p style={{ color: 'var(--z-danger)' }}>Не удалось загрузить лидерборд.</p>
      ) : entries === null ? (
        <SkeletonCard lines={6} />
      ) : (
        <Leaderboard title="Общий рейтинг" entries={entries} />
      )}
    </div>
  );
}
