'use client';

import type { LeaderboardEntry } from '@zaa4eem/shared';
import { useApiData } from '@/lib/use-api-data';
import { Leaderboard } from '@/components/Leaderboard';

export default function GlobalLeaderboardPage() {
  const { data: entries, error } = useApiData<LeaderboardEntry[]>('/leaderboard/global');

  return (
    <div style={{ maxWidth: 480 }}>
      <h1>Общий лидерборд</h1>
      {error ? (
        <p style={{ color: 'var(--z-danger)' }}>Не удалось загрузить лидерборд.</p>
      ) : (
        <Leaderboard title="Топ игроков" entries={entries ?? []} />
      )}
    </div>
  );
}
