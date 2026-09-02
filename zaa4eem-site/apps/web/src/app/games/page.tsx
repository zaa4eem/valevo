'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import type { Game } from '@zaa4eem/shared';
import { api } from '@/lib/api-client';
import { Card } from '@/components/Card';

export default function GamesPage() {
  const [games, setGames] = useState<Game[]>([]);

  useEffect(() => {
    api.get<Game[]>('/games').then(setGames);
  }, []);

  return (
    <div>
      <h1>Мини-игры</h1>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))', gap: 16 }}>
        {games.map((game) => (
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
    </div>
  );
}
