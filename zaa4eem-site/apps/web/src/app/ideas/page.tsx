'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import type { Idea, PaginatedIdeas } from '@zaa4eem/shared';
import { api } from '@/lib/api-client';
import { useAuth } from '@/lib/auth-context';
import { Card } from '@/components/Card';
import { IdeaCard } from '@/components/IdeaCard';
import { EmptyState } from '@/components/EmptyState';
import { SkeletonCard } from '@/components/Skeleton';

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
    <div style={{ maxWidth: 640, margin: '0 auto' }}>
      <Card
        className="z-animate-in"
        style={{
          marginBottom: 20,
          background: 'linear-gradient(135deg, var(--z-surface) 0%, var(--z-accent-soft) 140%)',
          position: 'relative',
          overflow: 'hidden',
        }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 16, flexWrap: 'wrap' }}>
          <div>
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
              Идеи
            </div>
            <h1 style={{ fontSize: 'var(--z-fs-3xl)', margin: 0, fontWeight: 900, lineHeight: 1.05 }}>
              💡 Что <span className="z-accent-text">добавить</span>?
            </h1>
            <p style={{ color: 'var(--z-text-muted)', margin: '8px 0 0', fontSize: 'var(--z-fs-sm)' }}>
              Предложи, что добавить — самое хайповое попадёт в разработку.
            </p>
          </div>
          {user ? (
            <Link href="/ideas/new" className="z-btn-accent z-pop-on-active">
              + Предложить идею
            </Link>
          ) : (
            <Link href="/login" className="z-btn-ghost z-pop-on-active">
              Войдите, чтобы предложить
            </Link>
          )}
        </div>
      </Card>

      <div className="z-animate-in" style={{ animationDelay: '60ms', display: 'flex', gap: 8, marginBottom: 16 }}>
        <button
          className={`${sort === 'top' ? 'z-btn-accent' : 'z-btn-ghost'} z-pop-on-active`}
          onClick={() => setSort('top')}
        >
          🔥 Топ
        </button>
        <button
          className={`${sort === 'new' ? 'z-btn-accent' : 'z-btn-ghost'} z-pop-on-active`}
          onClick={() => setSort('new')}
        >
          🆕 Новые
        </button>
      </div>

      {error ? (
        <p style={{ color: 'var(--z-danger)' }}>Не удалось загрузить идеи. Попробуйте обновить страницу.</p>
      ) : loading ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {Array.from({ length: 3 }).map((_, i) => (
            <SkeletonCard key={i} lines={2} />
          ))}
        </div>
      ) : ideas.length === 0 ? (
        <EmptyState icon="💡" description="Пока нет идей — стань первым, кто предложит что-то хайповое." />
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {ideas.map((idea, i) => (
            <IdeaCard key={idea.id} idea={idea} index={i} />
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
