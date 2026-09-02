'use client';

import { useCallback, useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import type { Game, LeaderboardEntry } from '@zaa4eem/shared';
import { api } from '@/lib/api-client';
import { useAuth } from '@/lib/auth-context';
import { Card } from '@/components/Card';
import { Leaderboard } from '@/components/Leaderboard';
import { NeonSnake } from '@/components/games/neon-snake/NeonSnake';

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
  if (!game) return <p style={{ color: 'var(--z-text-muted)' }}>Загрузка…</p>;

  return (
    <div className="z-game-layout">
      <div>
        <h1 style={{ marginTop: 0 }}>{game.title}</h1>
        <p style={{ color: 'var(--z-text-muted)' }}>{game.description}</p>
        {game.slug === 'neon-snake' ? (
          <NeonSnake onGameOver={onGameOver} />
        ) : (
          <Card>Игра скоро появится.</Card>
        )}
        {savedMessage && (
          <p style={{ marginTop: 12, color: 'var(--z-accent)', fontSize: 'var(--z-fs-sm)' }}>{savedMessage}</p>
        )}
      </div>
      <Leaderboard title="Лидерборд" entries={leaderboard} />
    </div>
  );
}
