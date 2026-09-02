'use client';

import Link from 'next/link';
import type { Game } from '@zaa4eem/shared';
import { useApiData } from '@/lib/use-api-data';
import { Card } from '@/components/Card';

export default function GamesPage() {
  const { data: games, error } = useApiData<Game[]>('/games');

  return (
    <div>
      <h1>Мини-игры</h1>
      {error ? (
        <p style={{ color: 'var(--z-danger)' }}>Не удалось загрузить список игр.</p>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))', gap: 16 }}>
          {(games ?? []).map((game) => (
            <Link key={game.slug} href={`/games/${game.slug}`}>
              <Card>
                <h3 style={{ margin: '0 0 6px' }}>{game.title}</h3>
                <p style={{ color: 'var(--z-text-muted)', fontSize: 'var(--z-fs-sm)', margin: 0 }}>
                  {game.description}
                </p>
              </Card>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
