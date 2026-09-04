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
import { ZClicker } from '@/components/games/z-clicker/ZClicker';
import { shareScoreCard } from '@/lib/share-card';

const GAME_ICONS: Record<string, string> = {
  'neon-snake': '🐍',
  'z-clicker': '🪙',
};
const DEFAULT_GAME_ICON = '🎮';

export default function GameDetailPage() {
  const params = useParams<{ slug: string }>();
  const { user } = useAuth();
  const [game, setGame] = useState<Game | null>(null);
  const [error, setError] = useState(false);
  const [leaderboard, setLeaderboard] = useState<LeaderboardEntry[]>([]);
  const [savedMessage, setSavedMessage] = useState<string | null>(null);
  const [lastScore, setLastScore] = useState<number | null>(null);
  const [sharing, setSharing] = useState(false);

  const isClicker = params.slug === 'z-clicker';

  const loadLeaderboard = useCallback(async () => {
    try {
      // The clicker isn't score-based (there's no single "round" to submit a
      // value for) — it has its own zCoins leaderboard instead.
      const data = await api.get<LeaderboardEntry[]>(
        isClicker ? '/clicker/leaderboard' : `/games/${params.slug}/leaderboard`,
      );
      setLeaderboard(data);
    } catch {
      // Non-fatal: the game itself can still be shown/played without a leaderboard.
    }
  }, [params.slug, isClicker]);

  useEffect(() => {
    setError(false);
    api.get<Game>(`/games/${params.slug}`).then(setGame, () => setError(true));
    loadLeaderboard();
  }, [params.slug, loadLeaderboard]);

  // The clicker leaderboard shifts continuously while playing, unlike a
  // score-based game's (which only changes on a "game over" event) — poll it
  // while this page is open instead of leaving it stale until a reload.
  useEffect(() => {
    if (!isClicker) return;
    const interval = setInterval(loadLeaderboard, 5000);
    return () => clearInterval(interval);
  }, [isClicker, loadLeaderboard]);

  async function onGameOver(score: number) {
    setLastScore(score);
    if (!user) {
      setSavedMessage('Войдите, чтобы сохранить результат в таблицу лидеров.');
      return;
    }
    try {
      await api.post(`/games/${params.slug}/scores`, { value: score });
      setSavedMessage(`Результат ${score} сохранён!`);
      loadLeaderboard();
    } catch {
      setSavedMessage('Не удалось сохранить результат — попробуйте ещё раз.');
    }
  }

  async function onShare() {
    if (lastScore === null || !game) return;
    setSharing(true);
    try {
      await shareScoreCard(game.title, lastScore);
    } finally {
      setSharing(false);
    }
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
          ) : isClicker ? (
            user ? (
              <ZClicker />
            ) : (
              <p style={{ color: 'var(--z-text-muted)', margin: 0, textAlign: 'center', padding: '24px 0' }}>
                Войдите, чтобы копить Z-коины.
              </p>
            )
          ) : (
            <p style={{ color: 'var(--z-text-muted)', margin: 0, textAlign: 'center', padding: '24px 0' }}>
              Игра скоро появится. 🛠️
            </p>
          )}
        </Card>
        {savedMessage && (
          <div style={{ marginTop: 12, display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
            <p style={{ margin: 0, color: 'var(--z-accent)', fontSize: 'var(--z-fs-sm)' }}>{savedMessage}</p>
            {lastScore !== null && (
              <button onClick={onShare} disabled={sharing} className="z-btn-ghost z-pop-on-active">
                {sharing ? '…' : '📤 Поделиться'}
              </button>
            )}
          </div>
        )}
      </div>
      <div className="z-animate-in" style={{ animationDelay: '100ms' }}>
        <Leaderboard title="Лидерборд" entries={leaderboard} />
      </div>
    </div>
  );
}
