'use client';

import { useCallback, useEffect, useState } from 'react';
import type { ModerationLogEntry } from '@zaa4eem/shared';
import { api } from '@/lib/api-client';
import { Card } from '@/components/Card';

interface ModerationQueue {
  ideas: { id: string; title: string; description: string; submitter: { displayName: string }; createdAt: string }[];
  scores: {
    id: string;
    value: number;
    game: { slug: string; title: string };
    user: { displayName: string };
    createdAt: string;
  }[];
}

export default function AdminModerationPage() {
  const [queue, setQueue] = useState<ModerationQueue | null>(null);
  const [log, setLog] = useState<ModerationLogEntry[]>([]);
  const [error, setError] = useState(false);

  const load = useCallback(async () => {
    setError(false);
    try {
      const [q, l] = await Promise.all([
        api.get<ModerationQueue>('/admin/moderation-queue'),
        api.get<ModerationLogEntry[]>('/admin/moderation-log'),
      ]);
      setQueue(q);
      setLog(l);
    } catch {
      setError(true);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function approveIdea(id: string) {
    await api.patch(`/ideas/${id}/moderation`, { moderationState: 'APPROVED' });
    load();
  }

  async function removeIdea(id: string) {
    await api.patch(`/ideas/${id}/moderation`, { moderationState: 'REMOVED', reason: 'Removed by owner' });
    load();
  }

  if (error) return <p style={{ color: 'var(--z-danger)' }}>Не удалось загрузить модерацию.</p>;
  if (!queue) return <p style={{ color: 'var(--z-text-muted)' }}>Загрузка…</p>;

  return (
    <div>
      <h1 style={{ marginTop: 0 }}>Модерация</h1>

      <h3>Идеи на проверке</h3>
      {queue.ideas.length === 0 ? (
        <p style={{ color: 'var(--z-text-muted)', fontSize: 'var(--z-fs-sm)' }}>Очередь пуста.</p>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginBottom: 24 }}>
          {queue.ideas.map((idea) => (
            <Card key={idea.id}>
              <div style={{ fontWeight: 700 }}>{idea.title}</div>
              <p style={{ color: 'var(--z-text-muted)', fontSize: 'var(--z-fs-sm)' }}>{idea.description}</p>
              <div style={{ fontSize: 'var(--z-fs-xs)', color: 'var(--z-text-faint)', marginBottom: 10 }}>
                от {idea.submitter.displayName}
              </div>
              <div style={{ display: 'flex', gap: 8 }}>
                <button className="z-btn-accent" onClick={() => approveIdea(idea.id)}>
                  Одобрить
                </button>
                <button className="z-btn-danger" onClick={() => removeIdea(idea.id)}>
                  Удалить
                </button>
              </div>
            </Card>
          ))}
        </div>
      )}

      <h3>Результаты игр на проверке</h3>
      {queue.scores.length === 0 ? (
        <p style={{ color: 'var(--z-text-muted)', fontSize: 'var(--z-fs-sm)' }}>Очередь пуста.</p>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginBottom: 24 }}>
          {queue.scores.map((score) => (
            <Card key={score.id}>
              <div>
                {score.user.displayName} — {score.game.title}: <strong>{score.value}</strong>
              </div>
            </Card>
          ))}
        </div>
      )}

      <h3>Журнал модерации</h3>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        {log.map((entry) => (
          <div key={entry.id} style={{ fontSize: 'var(--z-fs-sm)', color: 'var(--z-text-muted)' }}>
            {new Date(entry.createdAt).toLocaleString('ru-RU')} · {entry.actor.displayName} ·{' '}
            {entry.action} · {entry.targetType.toLowerCase()}
          </div>
        ))}
      </div>
    </div>
  );
}
