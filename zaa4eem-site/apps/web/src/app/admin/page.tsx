'use client';

import type { CSSProperties } from 'react';
import type { AdminStats } from '@zaa4eem/shared';
import { useApiData } from '@/lib/use-api-data';
import { StatTile } from '@/components/StatTile';
import { StatusBarChart, type StatusBarDatum } from '@/components/charts/StatusBarChart';
import { TrendChart } from '@/components/charts/TrendChart';

const IDEA_STATUS_LABELS: Record<string, string> = {
  NEW: 'Новая',
  UNDER_REVIEW: 'На рассмотрении',
  ACCEPTED: 'Принята',
  IN_PROGRESS: 'В разработке',
  SHIPPED: 'Готово',
  DECLINED: 'Отклонена',
};

// The pipeline is a forward-only progression (см. IDEA_STATUS_ORDER) with
// DECLINED as the one off-ramp — so it reads as a sequential green ramp
// (deeper green = closer to shipped) plus one clearly distinct outlier hue
// for the negative outcome, rather than six arbitrary categorical colors.
const IDEA_STATUS_COLORS: Record<string, string> = {
  NEW: 'color-mix(in oklab, var(--z-accent) 35%, var(--z-surface))',
  UNDER_REVIEW: 'color-mix(in oklab, var(--z-accent) 55%, var(--z-surface))',
  ACCEPTED: 'color-mix(in oklab, var(--z-accent) 75%, var(--z-surface))',
  IN_PROGRESS: 'color-mix(in oklab, var(--z-accent) 90%, var(--z-surface))',
  SHIPPED: 'var(--z-accent-strong)',
  DECLINED: 'var(--z-danger)',
};

const cardStyle: CSSProperties = { marginTop: 20 };

export default function AdminOverviewPage() {
  const { data: stats, error } = useApiData<AdminStats>('/admin/stats');

  if (error) return <p style={{ color: 'var(--z-danger)' }}>Не удалось загрузить статистику.</p>;
  if (!stats) return <p style={{ color: 'var(--z-text-muted)' }}>Загрузка…</p>;

  const statusData: StatusBarDatum[] = Object.entries(stats.ideasByStatus).map(([key, value]) => ({
    key,
    value,
    label: IDEA_STATUS_LABELS[key] ?? key,
    color: IDEA_STATUS_COLORS[key] ?? 'var(--z-text-faint)',
  }));

  const growthDates = stats.userGrowth.map((d) => d.date);
  const activityDates = stats.activity.map((d) => d.date);

  return (
    <div>
      <h1 style={{ marginTop: 0 }}>Обзор</h1>
      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
        <StatTile label="Пользователей" value={stats.totalUsers} />
        <StatTile label="Идей на модерации" value={stats.ideasPendingModeration} />
        <StatTile label="Партий сыграно" value={stats.totalGamePlays} />
      </div>

      <div className="z-card" style={cardStyle}>
        <h3 style={{ marginTop: 0 }}>Идеи по статусам</h3>
        <StatusBarChart data={statusData} />
      </div>

      <div className="z-card" style={cardStyle}>
        <h3 style={{ marginTop: 0, marginBottom: 2 }}>Рост пользователей</h3>
        <p style={{ margin: '0 0 12px', color: 'var(--z-text-muted)', fontSize: 'var(--z-fs-sm)' }}>
          Новые регистрации по дням, последние 30 дней
        </p>
        <TrendChart
          dates={growthDates}
          series={[{ key: 'count', label: 'Новых пользователей', color: 'var(--z-accent)' }]}
          values={{ count: stats.userGrowth.map((d) => d.count) }}
          areaFill
        />
      </div>

      <div className="z-card" style={cardStyle}>
        <h3 style={{ marginTop: 0, marginBottom: 2 }}>Активность платформы</h3>
        <p style={{ margin: '0 0 12px', color: 'var(--z-text-muted)', fontSize: 'var(--z-fs-sm)' }}>
          Публикации, идеи и результаты в играх по дням, последние 30 дней
        </p>
        <TrendChart
          dates={activityDates}
          series={[
            { key: 'posts', label: 'Посты', color: 'var(--z-accent)' },
            { key: 'ideas', label: 'Идеи', color: 'var(--z-info)' },
            { key: 'scores', label: 'Результаты игр', color: 'var(--z-warning)' },
          ]}
          values={{
            posts: stats.activity.map((d) => d.posts),
            ideas: stats.activity.map((d) => d.ideas),
            scores: stats.activity.map((d) => d.scores),
          }}
        />
      </div>
    </div>
  );
}
