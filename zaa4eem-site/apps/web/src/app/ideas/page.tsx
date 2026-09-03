'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import type { Idea, PaginatedIdeas } from '@zaa4eem/shared';
import { api } from '@/lib/api-client';
import { useAuth } from '@/lib/auth-context';
import { IdeaCard } from '@/components/IdeaCard';

export default function IdeasPage() {
  const { user } = useAuth();
  const [sort, setSort] = useState<'top' | 'new'>('top');
  const [ideas, setIdeas] = useState<Idea[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(false);
    try {
      const page = await api.get<PaginatedIdeas>(`/ideas?sort=${sort}`);
      setIdeas(page.items);
      setNextCursor(page.nextCursor);
    } catch {
      setError(true);
    } finally {
      setLoading(false);
    }
  }, [sort]);

  useEffect(() => {
    load();
  }, [load]);

  async function loadMore() {
    if (!nextCursor || loadingMore) return;
    setLoadingMore(true);
    try {
      const page = await api.get<PaginatedIdeas>(`/ideas?sort=${sort}&cursor=${nextCursor}`);
      setIdeas((prev) => [...prev, ...page.items]);
      setNextCursor(page.nextCursor);
    } finally {
      setLoadingMore(false);
    }
  }

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

      {error ? (
        <p style={{ color: 'var(--z-danger)' }}>Не удалось загрузить идеи. Попробуйте обновить страницу.</p>
      ) : loading ? (
        <p style={{ color: 'var(--z-text-muted)' }}>Загрузка…</p>
      ) : ideas.length === 0 ? (
        <p style={{ color: 'var(--z-text-muted)' }}>
          Пока нет идей — стань первым, кто предложит что-то хайповое.
        </p>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {ideas.map((idea) => (
            <IdeaCard key={idea.id} idea={idea} />
          ))}
          {nextCursor && (
            <button
              onClick={loadMore}
              disabled={loadingMore}
              className="z-btn-ghost z-pop-on-active"
              style={{ alignSelf: 'center', opacity: loadingMore ? 0.6 : 1 }}
            >
              {loadingMore ? 'Загрузка…' : 'Показать ещё'}
            </button>
          )}
        </div>
      )}
    </div>
  );
}
