'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import type { PaginatedScrolls, Scroll } from '@zaa4eem/shared';
import { api } from '@/lib/api-client';
import { useAuth } from '@/lib/auth-context';
import { Card } from '@/components/Card';
import { EmptyState } from '@/components/EmptyState';
import { ScrollCard } from '@/components/scrolls/ScrollCard';

export default function ScrollsPage() {
  const { user } = useAuth();
  const [items, setItems] = useState<Scroll[] | null>(null);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [error, setError] = useState(false);
  const [activeId, setActiveId] = useState<string | null>(null);
  const railRef = useRef<HTMLDivElement>(null);
  const loadingMore = useRef(false);

  useEffect(() => {
    api
      .get<PaginatedScrolls>('/scrolls')
      .then((page) => {
        setItems(page.items);
        setNextCursor(page.nextCursor);
        setActiveId(page.items[0]?.id ?? null);
      })
      .catch(() => setError(true));
  }, []);

  const loadMore = useCallback(async () => {
    if (!nextCursor || loadingMore.current) return;
    loadingMore.current = true;
    try {
      const page = await api.get<PaginatedScrolls>(`/scrolls?cursor=${nextCursor}`);
      setItems((current) => [...(current ?? []), ...page.items]);
      setNextCursor(page.nextCursor);
    } catch {
      // Keep what's loaded; the next scroll will try again.
    } finally {
      loadingMore.current = false;
    }
  }, [nextCursor]);

  /**
   * Which clip is on screen.
   *
   * An observer rather than a scroll handler: with snap scrolling the
   * browser can land on a clip without firing a final scroll event at a
   * position that reads as "settled", and a half-visible clip playing
   * behind the one you're watching is exactly the bug that makes a feed
   * like this feel broken.
   */
  useEffect(() => {
    const rail = railRef.current;
    if (!rail || !items?.length || typeof IntersectionObserver === 'undefined') return;
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting && entry.intersectionRatio > 0.6) {
            const id = (entry.target as HTMLElement).dataset.scrollId;
            if (id) setActiveId(id);
          }
        }
      },
      { root: rail, threshold: [0.6] },
    );
    rail.querySelectorAll('[data-scroll-id]').forEach((node) => observer.observe(node));
    return () => observer.disconnect();
  }, [items]);

  // Loads the next page before the viewer reaches the end, so the feed
  // never stops under them.
  useEffect(() => {
    if (!items?.length || !activeId) return;
    const index = items.findIndex((s) => s.id === activeId);
    if (index >= items.length - 2) loadMore();
  }, [activeId, items, loadMore]);

  function replace(updated: Scroll) {
    setItems((current) => (current ?? []).map((s) => (s.id === updated.id ? updated : s)));
  }

  return (
    <div style={{ maxWidth: 440, margin: '0 auto' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12, flexWrap: 'wrap' }}>
        <h1 style={{ fontSize: 'var(--z-fs-2xl)', margin: 0, fontWeight: 900 }}>
          Scrolls<span className="z-accent-text">😁</span>
        </h1>
        {user && (
          <div style={{ marginLeft: 'auto', display: 'flex', gap: 8 }}>
            <Link href="/scrolls/mine" className="z-btn-ghost z-pop-on-active" style={{ fontSize: 'var(--z-fs-xs)', padding: '6px 12px' }}>
              Мои
            </Link>
            <Link href="/scrolls/upload" className="z-btn-accent z-pop-on-active" style={{ fontSize: 'var(--z-fs-xs)', padding: '6px 12px' }}>
              + Загрузить
            </Link>
          </div>
        )}
      </div>

      {error ? (
        <p style={{ color: 'var(--z-danger)' }}>Не удалось загрузить ленту.</p>
      ) : items === null ? (
        <Card className="z-scroll-rail" style={{ display: 'grid', placeItems: 'center', color: 'var(--z-text-faint)' }}>
          Загружаем…
        </Card>
      ) : items.length === 0 ? (
        <EmptyState
          icon="🎬"
          title="Роликов пока нет"
          description={
            user
              ? 'Каждый ролик смотрит человек перед публикацией, так что первый твой — и будет первым тут.'
              : 'Загляни чуть позже — или войди и сними первый.'
          }
          action={
            <Link href={user ? '/scrolls/upload' : '/login'} className="z-btn-accent z-pop-on-active">
              {user ? 'Загрузить ролик' : 'Войти'}
            </Link>
          }
        />
      ) : (
        <div
          ref={railRef}
          className="z-scroll-rail"
          style={{
            overflowY: 'auto',
            scrollSnapType: 'y mandatory',
            borderRadius: 'var(--z-radius-md)',
            // Hides the scrollbar without hiding the scrolling — a visible
            // track down the side of a video feed looks like a mistake.
            scrollbarWidth: 'none',
          }}
        >
          {items.map((scroll) => (
            <div key={scroll.id} data-scroll-id={scroll.id} style={{ height: '100%' }}>
              <ScrollCard scroll={scroll} active={scroll.id === activeId} onChange={replace} />
            </div>
          ))}
        </div>
      )}

      <p style={{ marginTop: 10, fontSize: 'var(--z-fs-xs)', color: 'var(--z-text-faint)', textAlign: 'center' }}>
        Листай вверх · нажми на видео, чтобы поставить на паузу
      </p>
    </div>
  );
}
