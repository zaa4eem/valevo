'use client';

import { useEffect, useState } from 'react';
import type { AdminStats } from '@zaa4eem/shared';
import { api } from '@/lib/api-client';
import { StatTile } from '@/components/StatTile';

export default function AdminOverviewPage() {
  const [stats, setStats] = useState<AdminStats | null>(null);

  useEffect(() => {
    api.get<AdminStats>('/admin/stats').then(setStats);
  }, []);

  if (!stats) return <p style={{ color: 'var(--z-text-muted)' }}>Загрузка…</p>;

  return (
    <div>
      <h1 style={{ marginTop: 0 }}>Обзор</h1>
      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
        <StatTile label="Пользователей" value={stats.totalUsers} />
        <StatTile label="Идей на модерации" value={stats.ideasPendingModeration} />
        <StatTile label="Партий сыграно" value={stats.totalGamePlays} />
      </div>
      <div style={{ marginTop: 24 }}>
        <h3>Идеи по статусам</h3>
        <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
          {Object.entries(stats.ideasByStatus).map(([status, count]) => (
            <StatTile key={status} label={status} value={count} />
          ))}
        </div>
      </div>
    </div>
  );
}
