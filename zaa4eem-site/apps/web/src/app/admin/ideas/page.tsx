'use client';

import { useCallback, useEffect, useState } from 'react';
import type { Idea, IdeaStatus } from '@zaa4eem/shared';
import { api } from '@/lib/api-client';
import { Card } from '@/components/Card';

const STATUS_FLOW: { value: IdeaStatus; label: string }[] = [
  { value: 'NEW', label: 'Новая' },
  { value: 'UNDER_REVIEW', label: 'На рассмотрении' },
  { value: 'ACCEPTED', label: 'Принята' },
  { value: 'IN_PROGRESS', label: 'В разработке' },
  { value: 'SHIPPED', label: 'Готово' },
  { value: 'DECLINED', label: 'Отклонена' },
];

export default function AdminIdeasPage() {
  const [ideas, setIdeas] = useState<Idea[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(false);
    try {
      const data = await api.get<Idea[]>('/ideas?sort=new');
      setIdeas(data);
    } catch {
      setError(true);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function changeStatus(id: string, status: IdeaStatus) {
    await api.patch(`/ideas/${id}/status`, { status });
    load();
  }

  async function approve(id: string) {
    await api.patch(`/ideas/${id}/moderation`, { moderationState: 'APPROVED' });
    load();
  }

  async function remove(id: string) {
    await api.patch(`/ideas/${id}/moderation`, { moderationState: 'REMOVED', reason: 'Removed by owner' });
    load();
  }

  if (error) return <p style={{ color: 'var(--z-danger)' }}>Не удалось загрузить идеи.</p>;
  if (loading) return <p style={{ color: 'var(--z-text-muted)' }}>Загрузка…</p>;

  return (
    <div>
      <h1 style={{ marginTop: 0 }}>Идеи — управление</h1>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        {ideas.map((idea) => (
          <Card key={idea.id}>
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 16 }}>
              <div style={{ flex: 1 }}>
                <div style={{ fontWeight: 700 }}>{idea.title}</div>
                <p style={{ color: 'var(--z-text-muted)', fontSize: 'var(--z-fs-sm)' }}>{idea.description}</p>
                <div style={{ fontSize: 'var(--z-fs-xs)', color: 'var(--z-text-faint)' }}>
                  от {idea.submitter.displayName} · {idea.voteCount} голосов ·{' '}
                  {idea.moderationState === 'PENDING_REVIEW' ? 'ждёт модерации' : idea.moderationState}
                </div>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6, minWidth: 180 }}>
                <select
                  className="z-input"
                  value={idea.status}
                  onChange={(e) => changeStatus(idea.id, e.target.value as IdeaStatus)}
                >
                  {STATUS_FLOW.map((s) => (
                    <option key={s.value} value={s.value}>
                      {s.label}
                    </option>
                  ))}
                </select>
                {idea.moderationState === 'PENDING_REVIEW' && (
                  <div style={{ display: 'flex', gap: 6 }}>
                    <button className="z-btn-accent" onClick={() => approve(idea.id)}>
                      Одобрить
                    </button>
                    <button className="z-btn-danger" onClick={() => remove(idea.id)}>
                      Удалить
                    </button>
                  </div>
                )}
              </div>
            </div>
          </Card>
        ))}
      </div>
    </div>
  );
}
