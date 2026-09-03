'use client';

import Link from 'next/link';
import type { Game } from '@zaa4eem/shared';
import { useApiData } from '@/lib/use-api-data';
import { Card } from '@/components/Card';
import { EmptyState } from '@/components/EmptyState';
import { SkeletonCard } from '@/components/Skeleton';

// A small set of hand-picked icons for known games, with a generic
// fallback for anything added later — purely a visual accent, not data.
const GAME_ICONS: Record<string, string> = {
  'neon-snake': '🐍',
};
const DEFAULT_GAME_ICON = '🎮';

function GameCard({ game, index }: { game: Game; index: number }) {
  const icon = GAME_ICONS[game.slug] ?? DEFAULT_GAME_ICON;
  return (
    <Link href={`/games/${game.slug}`}>
      <Card hover className="z-animate-in" style={{ animationDelay: `${Math.min(index, 8) * 45}ms`, height: '100%' }}>
        <div
          style={{
            width: 48,
            height: 48,
            borderRadius: 'var(--z-radius-md)',
            background: 'var(--z-accent-soft)',
            display: 'grid',
            placeItems: 'center',
            fontSize: 24,
            marginBottom: 14,
          }}
        >
          {icon}
        </div>
        <h3 style={{ margin: '0 0 6px' }}>{game.title}</h3>
        <p style={{ color: 'var(--z-text-muted)', fontSize: 'var(--z-fs-sm)', margin: 0 }}>{game.description}</p>
        <div
          style={{
            marginTop: 14,
            fontSize: 'var(--z-fs-xs)',
            fontWeight: 700,
            color: 'var(--z-accent)',
            display: 'flex',
            alignItems: 'center',
            gap: 4,
          }}
        >
          Играть →
        </div>
      </Card>
    </Link>
  );
}

export default function GamesPage() {
  const { data: games, error } = useApiData<Game[]>('/games');

  return (
    <div>
      <Card
        className="z-animate-in"
        style={{
          marginBottom: 20,
          background: 'linear-gradient(135deg, var(--z-surface) 0%, var(--z-accent-soft) 140%)',
          position: 'relative',
          overflow: 'hidden',
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
          Игры
        </div>
        <h1 style={{ fontSize: 'var(--z-fs-3xl)', margin: 0, fontWeight: 900, lineHeight: 1.05 }}>
          Мини-<span className="z-accent-text">игры</span>
        </h1>
        <p style={{ color: 'var(--z-text-muted)', margin: '8px 0 0', fontSize: 'var(--z-fs-sm)' }}>
          Заходи, играй и попадай в таблицу лидеров. 🏆
        </p>
      </Card>

      {error ? (
        <p style={{ color: 'var(--z-danger)' }}>Не удалось загрузить список игр.</p>
      ) : games === null ? (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))', gap: 16 }}>
          {Array.from({ length: 3 }).map((_, i) => (
            <SkeletonCard key={i} lines={2} />
          ))}
        </div>
      ) : games.length === 0 ? (
        <EmptyState icon="🎮" description="Пока нет игр — загляни чуть позже." />
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))', gap: 16 }}>
          {games.map((game, i) => (
            <GameCard key={game.slug} game={game} index={i} />
          ))}
        </div>
      )}
    </div>
  );
}
