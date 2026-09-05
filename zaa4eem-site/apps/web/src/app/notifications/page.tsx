'use client';

import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import type { Notification, PaginatedNotifications } from '@zaa4eem/shared';
import { api } from '@/lib/api-client';
import { useAuth } from '@/lib/auth-context';
import { useNotifications } from '@/lib/notifications-context';
import { Card } from '@/components/Card';
import { NotificationRow } from '@/components/NotificationRow';
import { PushToggle } from '@/components/PushToggle';

const FILTERS = [
  { key: 'all', label: 'Все', icon: '🔔' },
  { key: 'social', label: 'Общение', icon: '💬' },
  { key: 'games', label: 'Игры', icon: '🎮' },
  { key: 'ideas', label: 'Идеи', icon: '💡' },
] as const;

type FilterKey = (typeof FILTERS)[number]['key'];

export default function NotificationsPage() {
  const { user, loading: authLoading } = useAuth();
  const { unreadCount, setUnreadCount, refresh } = useNotifications();
  const router = useRouter();

  const [filter, setFilter] = useState<FilterKey>('all');
  const [items, setItems] = useState<Notification[] | null>(null);
  const [cursor, setCursor] = useState<string | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(
    async (nextFilter: FilterKey) => {
      setItems(null);
      setError(null);
      try {
        const page = await api.get<PaginatedNotifications>(`/notifications?filter=${nextFilter}&limit=20`);
        setItems(page.items);
        setCursor(page.nextCursor);
        setUnreadCount(page.unreadCount);
      } catch {
        setError('Не удалось загрузить уведомления');
      }
    },
    [setUnreadCount],
  );

  useEffect(() => {
    if (!user) return;
    load(filter);
  }, [user, filter, load]);

  async function loadMore() {
    if (!cursor || loadingMore) return;
    setLoadingMore(true);
    try {
      const page = await api.get<PaginatedNotifications>(
        `/notifications?filter=${filter}&limit=20&cursor=${cursor}`,
      );
      setItems((current) => [...(current ?? []), ...page.items]);
      setCursor(page.nextCursor);
    } catch {
      setError('Не удалось загрузить ещё');
    } finally {
      setLoadingMore(false);
    }
  }

  async function markAllRead() {
    setItems((current) => current?.map((n) => ({ ...n, read: true })) ?? current);
    setUnreadCount(0);
    try {
      await api.post('/notifications/read-all');
    } catch {
      refresh();
    }
  }

  async function open(notification: Notification) {
    if (!notification.read) {
      setItems((current) =>
        current?.map((n) => (n.id === notification.id ? { ...n, read: true } : n)) ?? current,
      );
      setUnreadCount(Math.max(0, unreadCount - 1));
      api.post(`/notifications/${notification.id}/read`).catch(() => refresh());
    }
    if (notification.href) router.push(notification.href);
  }

  if (authLoading) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        {[0, 1, 2, 3].map((i) => (
          <span key={i} className="z-skeleton" style={{ height: 64, borderRadius: 'var(--z-radius-md)' }} />
        ))}
      </div>
    );
  }

  if (!user) {
    return (
      <Card className="z-animate-in" style={{ textAlign: 'center', padding: '40px 20px' }}>
        <div style={{ fontSize: 40, marginBottom: 12 }}>🔔</div>
        <h1 style={{ marginTop: 0, fontSize: 'var(--z-fs-lg)' }}>Уведомления</h1>
        <p style={{ color: 'var(--z-text-muted)', fontSize: 'var(--z-fs-sm)' }}>
          Войдите, чтобы видеть лайки, ответы и побитые рекорды.
        </p>
        <Link href="/login" className="z-btn-accent z-pop-on-active" style={{ display: 'inline-block', marginTop: 8 }}>
          Войти
        </Link>
      </Card>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 12,
          flexWrap: 'wrap',
        }}
      >
        <h1 style={{ margin: 0, fontSize: 'var(--z-fs-xl)' }}>
          Уведомления
          {unreadCount > 0 && (
            <span className="z-notif-count-pill">{unreadCount > 99 ? '99+' : unreadCount}</span>
          )}
        </h1>
        {unreadCount > 0 && (
          <button onClick={markAllRead} className="z-btn-ghost z-pop-on-active">
            Прочитать все
          </button>
        )}
      </div>

      <PushToggle />

      {/* A scrollable chip row rather than a select — one tap to switch, and
          it never overflows the narrow screens most of this traffic is on. */}
      <div className="z-chip-row" role="tablist" aria-label="Фильтр уведомлений">
        {FILTERS.map((f) => (
          <button
            key={f.key}
            role="tab"
            aria-selected={filter === f.key}
            onClick={() => setFilter(f.key)}
            className={`z-chip z-pop-on-active${filter === f.key ? ' z-chip-active' : ''}`}
          >
            <span aria-hidden>{f.icon}</span> {f.label}
          </button>
        ))}
      </div>

      {error && (
        <Card style={{ borderColor: 'var(--z-danger)' }}>
          <div style={{ color: 'var(--z-danger)', marginBottom: 10 }}>{error}</div>
          <button onClick={() => load(filter)} className="z-btn-accent z-pop-on-active">
            Повторить
          </button>
        </Card>
      )}

      {!error && items === null && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {[0, 1, 2, 3, 4].map((i) => (
            <span key={i} className="z-skeleton" style={{ height: 64, borderRadius: 'var(--z-radius-md)' }} />
          ))}
        </div>
      )}

      {!error && items?.length === 0 && (
        <Card className="z-animate-in" style={{ textAlign: 'center', padding: '40px 20px' }}>
          <div style={{ fontSize: 40, marginBottom: 12 }}>🌱</div>
          <div style={{ fontWeight: 700, marginBottom: 6 }}>Здесь пока пусто</div>
          <p style={{ color: 'var(--z-text-muted)', fontSize: 'var(--z-fs-sm)', margin: 0 }}>
            {filter === 'games'
              ? 'Поставьте рекорд — и узнаете первым, когда его попытаются побить.'
              : filter === 'ideas'
                ? 'Предложите идею — сюда придёт ответ, когда её рассмотрят.'
                : 'Лайки, ответы и новые подписчики появятся здесь.'}
          </p>
        </Card>
      )}

      {items && items.length > 0 && (
        <Card className="z-animate-in" style={{ padding: 0, overflow: 'hidden' }}>
          <div className="z-notif-list">
            {items.map((notification) => (
              <NotificationRow
                key={notification.id}
                notification={notification}
                onClick={() => open(notification)}
              />
            ))}
          </div>
        </Card>
      )}

      {cursor && (
        <button
          onClick={loadMore}
          disabled={loadingMore}
          className="z-btn-ghost z-pop-on-active"
          style={{ alignSelf: 'center' }}
        >
          {loadingMore ? 'Загрузка…' : 'Показать ещё'}
        </button>
      )}
    </div>
  );
}
