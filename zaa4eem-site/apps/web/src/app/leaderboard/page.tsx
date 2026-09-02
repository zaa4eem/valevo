'use client';

import { useEffect, useState } from 'react';
import type { LeaderboardEntry } from '@zaa4eem/shared';
import { api } from '@/lib/api-client';
import { Leaderboard } from '@/components/Leaderboard';

export default function GlobalLeaderboardPage() {
  const [entries, setEntries] = useState<LeaderboardEntry[]>([]);

  useEffect(() => {
    api.get<LeaderboardEntry[]>('/leaderboard/global').then(setEntries);
  }, []);

  return (
    <div style={{ maxWidth: 480 }}>
      <h1>Общий лидерборд</h1>
      <Leaderboard title="Топ игроков" entries={entries} />
    </div>
  );
}
