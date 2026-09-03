'use client';

import { useCallback, useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import type { Game, LeaderboardEntry } from '@zaa4eem/shared';
import { api } from '@/lib/api-client';
import { useAuth } from '@/lib/auth-context';
import { Card } from '@/components/Card';
import { Leaderboard } from '@/components/Leaderboard';
import { SkeletonCard } from '@/components/Skeleton';
import { NeonSnake } from '@/components/games/neon-snake/NeonSnake';

const GAME_ICONS: Record<string, string> = {
  'neon-snake': '🐍',
};
const DEFAULT_GAME_ICON = '🎮';

export default function GameDetailPage() {
  const params = useParams<{ slug: string }>();
  const { user } = useAuth();
  const [game, setGame] = useState<Game | null>(null);
  const [error, setError] = useState(false);
  const [leaderboard, setLeaderboard] = useState<LeaderboardEntry[]>([]);
  const [savedMessage, setSavedMessage] = useState<string | null>(null);

  const loadLeaderboard = useCallback(async () => {
    try {
      const data = await api.get<LeaderboardEntry[]>(`/games/${params.slug}/leaderboard`);
      setLeaderboard(data);
    } catch {
      // Non-fatal: the game itself can still be shown/played without a leaderboard.
    }
  }, [params.slug]);

  useEffect(() => {
    setError(false);
    api.get<Game>(`/games/${params.slug}`).then(setGame, () => setError(true));
    loadLeaderboard();
  }, [params.slug, loadLeaderboard]);

  async function onGameOver(score: number) {
    if (!user) {
      setSavedMessage('Войдите, чтобы сохранить результат в таблицу лидеров.');
      return;
    }
    await api.post(`/games/${params.slug}/scores`, { value: score });
    setSavedMessage(`Результат ${score} сохранён!`);
    loadLeaderboard();
  }

  if (error) return <p style={{ color: 'var(--z-danger)' }}>Не удалось загрузить игру.</p>;

  if (!game) {
    return (
      <div className="z-game-layout">
        <SkeletonCard lines={2} />
        <SkeletonCard lines={4} />
      </div>
    );
  }

  const icon = GAME_ICONS[game.slug] ?? DEFAULT_GAME_ICON;

  return (
    <div className="z-game-layout">
      <div>
        <Card
          className="z-animate-in"
          style={{
            marginBottom: 16,
            background: 'linear-gradient(135deg, var(--z-surface) 0%, var(--z-accent-soft) 140%)',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
            <div
              style={{
                width: 52,
                height: 52,
                borderRadius: 'var(--z-radius-md)',
                background: 'var(--z-accent-soft)',
                display: 'grid',
                placeItems: 'center',
                fontSize: 28,
                flexShrink: 0,
              }}
            >
              {icon}
            </div>
            <div>
              <h1 style={{ margin: 0, fontSize: 'var(--z-fs-2xl)', fontWeight: 900 }}>{game.title}</h1>
              <p style={{ color: 'var(--z-text-muted)', margin: '4px 0 0', fontSize: 'var(--z-fs-sm)' }}>
                {game.description}
              </p>
            </div>
          </div>
        </Card>

        <Card className="z-animate-in" style={{ animationDelay: '60ms' }}>
          {game.slug === 'neon-snake' ? (
            <NeonSnake onGameOver={onGameOver} />
          ) : (
            <p style={{ color: 'var(--z-text-muted)', margin: 0, textAlign: 'center', padding: '24px 0' }}>
              Игра скоро появится. 🛠️
            </p>
          )}
        </Card>
        {savedMessage && (
          <p style={{ marginTop: 12, color: 'var(--z-accent)', fontSize: 'var(--z-fs-sm)' }}>{savedMessage}</p>
        )}
      </div>
      <div className="z-animate-in" style={{ animationDelay: '100ms' }}>
        <Leaderboard title="Лидерборд" entries={leaderboard} />
      </div>
    </div>
  );
}
