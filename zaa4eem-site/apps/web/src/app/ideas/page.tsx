'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import type { Idea } from '@zaa4eem/shared';
import { api } from '@/lib/api-client';
import { useAuth } from '@/lib/auth-context';
import { IdeaCard } from '@/components/IdeaCard';

export default function IdeasPage() {
  const { user } = useAuth();
  const [sort, setSort] = useState<'top' | 'new'>('top');
  const [ideas, setIdeas] = useState<Idea[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    const data = await api.get<Idea[]>(`/ideas?sort=${sort}`);
    setIdeas(data);
    setLoading(false);
  }, [sort]);

  useEffect(() => {
    load();
  }, [load]);

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
        <div>
          <h1 style={{ fontSize: 'var(--z-fs-2xl)', margin: 0 }}>Идеи</h1>
          <p style={{ color: 'var(--z-text-muted)', margin: '4px 0 0' }}>
            Предложи, что добавить — самое хайповое попадёт в разработку.
          </p>
        </div>
        {user ? (
          <Link href="/ideas/new" className="z-btn-accent">
            + Предложить идею
          </Link>
        ) : (
          <Link href="/login" className="z-btn-ghost">
            Войдите, чтобы предложить
          </Link>
        )}
      </div>

      <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
        <button
          className={sort === 'top' ? 'z-btn-accent' : 'z-btn-ghost'}
          onClick={() => setSort('top')}
        >
          Топ
        </button>
        <button
          className={sort === 'new' ? 'z-btn-accent' : 'z-btn-ghost'}
          onClick={() => setSort('new')}
        >
          Новые
        </button>
      </div>

      {loading ? (
        <p style={{ color: 'var(--z-text-muted)' }}>Загрузка…</p>
      ) : ideas.length === 0 ? (
        <p style={{ color: 'var(--z-text-muted)' }}>
          Пока нет идей — стань первым, кто предложит что-то хайповое.
        </p>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {ideas.map((idea) => (
            <IdeaCard key={idea.id} idea={idea} onVoteChange={load} />
          ))}
        </div>
      )}
    </div>
  );
}
