'use client';

import { useState } from 'react';
import Link from 'next/link';
import type { LeaderboardEntry, SeasonLeaderboardEntry } from '@zaa4eem/shared';
import { seasonAt } from '@zaa4eem/shared';
import { useApiData } from '@/lib/use-api-data';
import { Card } from '@/components/Card';
import { Leaderboard } from '@/components/Leaderboard';
import { SkeletonCard } from '@/components/Skeleton';

type Tab = 'global' | 'season';

export default function GlobalLeaderboardPage() {
  const [tab, setTab] = useState<Tab>('global');
  const { data: entries, error } = useApiData<LeaderboardEntry[]>('/leaderboard/global');
  const { data: seasonEntries, error: seasonError } = useApiData<SeasonLeaderboardEntry[]>(
    '/progress/season/leaderboard?limit=30',
  );
  const season = seasonAt();

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
          {tab === 'global'
            ? 'Суммарный счёт по всем мини-играм. 🎮'
            : `Сезон ${season.index}: опыт за всё — посты, идеи, игры. Осталось ${season.daysLeft} дн.`}
        </p>
      </Card>

      {/* Two boards, deliberately different: the global one rewards raw skill
          in the games and never resets; the season one rewards being around
          at all and starts everyone from zero every four weeks, so someone
          who joined yesterday still has something to win. */}
      <div className="z-chip-row" style={{ marginBottom: 16 }} role="tablist">
        <button
          role="tab"
          aria-selected={tab === 'global'}
          onClick={() => setTab('global')}
          className={`z-chip z-pop-on-active${tab === 'global' ? ' z-chip-active' : ''}`}
        >
          🎮 Игры
        </button>
        <button
          role="tab"
          aria-selected={tab === 'season'}
          onClick={() => setTab('season')}
          className={`z-chip z-pop-on-active${tab === 'season' ? ' z-chip-active' : ''}`}
        >
          🏆 Сезон {season.index}
        </button>
      </div>

      {tab === 'global' ? (
        error ? (
          <p style={{ color: 'var(--z-danger)' }}>Не удалось загрузить лидерборд.</p>
        ) : entries === null ? (
          <SkeletonCard lines={6} />
        ) : (
          <Leaderboard title="Общий рейтинг" entries={entries} />
        )
      ) : seasonError ? (
        <p style={{ color: 'var(--z-danger)' }}>Не удалось загрузить таблицу сезона.</p>
      ) : seasonEntries === null ? (
        <SkeletonCard lines={6} />
      ) : seasonEntries.length === 0 ? (
        <Card style={{ textAlign: 'center', padding: '32px 20px' }}>
          <div style={{ fontSize: 34, marginBottom: 8 }}>🌱</div>
          <div style={{ fontWeight: 700, marginBottom: 6 }}>Сезон только начался</div>
          <p style={{ color: 'var(--z-text-muted)', fontSize: 'var(--z-fs-sm)', margin: 0 }}>
            Первый, кто заработает опыт, займёт первое место.
          </p>
          <Link href="/progress" className="z-btn-accent z-pop-on-active" style={{ display: 'inline-block', marginTop: 12 }}>
            К заданиям
          </Link>
        </Card>
      ) : (
        <Leaderboard
          title={`Сезон ${season.index}`}
          entries={seasonEntries.map((entry) => ({
            rank: entry.rank,
            userId: entry.userId,
            displayName: entry.displayName,
            avatarUrl: entry.avatarUrl,
            value: entry.xp,
          }))}
        />
      )}
    </div>
  );
}
