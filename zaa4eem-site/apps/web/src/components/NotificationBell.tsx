'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import type { PaginatedNotifications, Notification } from '@zaa4eem/shared';
import { api } from '@/lib/api-client';
import { useNotifications } from '@/lib/notifications-context';
import { NotificationRow } from './NotificationRow';

/** How many fit in the dropdown before "смотреть все" takes over. */
const PREVIEW_LIMIT = 6;

export function NotificationBell() {
  const { unreadCount, setUnreadCount, refresh } = useNotifications();
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<Notification[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const ref = useRef<HTMLDivElement>(null);
  const router = useRouter();

  useEffect(() => {
    function onClickOutside(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    function onEscape(e: KeyboardEvent) {
      if (e.key === 'Escape') setOpen(false);
    }
    document.addEventListener('mousedown', onClickOutside);
    document.addEventListener('keydown', onEscape);
    return () => {
      document.removeEventListener('mousedown', onClickOutside);
      document.removeEventListener('keydown', onEscape);
    };
  }, []);

  // The list is fetched when the panel opens, not kept warm in the background:
  // the badge already comes over the live stream, and most sessions never
  // open this at all.
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setError(null);
    api
      .get<PaginatedNotifications>(`/notifications?limit=${PREVIEW_LIMIT}`)
      .then((page) => {
        if (cancelled) return;
        setItems(page.items);
        setUnreadCount(page.unreadCount);
      })
      .catch(() => {
        if (!cancelled) setError('Не удалось загрузить уведомления');
      });
    return () => {
      cancelled = true;
    };
  }, [open, setUnreadCount]);

  async function markAllRead() {
    setItems((current) => current?.map((n) => ({ ...n, read: true })) ?? current);
    setUnreadCount(0);
    try {
      await api.post('/notifications/read-all');
    } catch {
      // Put the truth back if the server disagreed.
      refresh();
    }
  }

  async function openNotification(notification: Notification) {
    setOpen(false);
    if (!notification.read) {
      setItems((current) =>
        current?.map((n) => (n.id === notification.id ? { ...n, read: true } : n)) ?? current,
      );
      setUnreadCount(Math.max(0, unreadCount - 1));
      api.post(`/notifications/${notification.id}/read`).catch(() => refresh());
    }
    if (notification.href) router.push(notification.href);
  }

  return (
    <div ref={ref} style={{ position: 'relative' }}>
      <button
        onClick={() => setOpen((o) => !o)}
        className="z-btn-ghost z-pop-on-active"
        aria-label={unreadCount > 0 ? `Уведомления, непрочитанных: ${unreadCount}` : 'Уведомления'}
        aria-expanded={open}
        style={{ padding: '6px 10px', position: 'relative', lineHeight: 1 }}
      >
        <span style={{ fontSize: 18 }}>🔔</span>
        {unreadCount > 0 && (
          <span className="z-notif-badge" aria-hidden>
            {unreadCount > 99 ? '99+' : unreadCount}
          </span>
        )}
      </button>

      {open && (
        <div className="z-navbar-menu z-notif-panel z-animate-fade" role="dialog" aria-label="Уведомления">
          <div className="z-notif-panel-head">
            <span style={{ fontWeight: 800 }}>Уведомления</span>
            {unreadCount > 0 && (
              <button onClick={markAllRead} className="z-notif-mark-all">
                Прочитать все
              </button>
            )}
          </div>

          <div className="z-notif-panel-body">
            {error && (
              <div style={{ padding: '16px 14px', color: 'var(--z-danger)', fontSize: 'var(--z-fs-sm)' }}>
                {error}
              </div>
            )}
            {!error && items === null && (
              <div style={{ padding: 14, display: 'flex', flexDirection: 'column', gap: 10 }}>
                {[0, 1, 2].map((i) => (
                  <span key={i} className="z-skeleton" style={{ height: 44, borderRadius: 'var(--z-radius-sm)' }} />
                ))}
              </div>
            )}
            {!error && items?.length === 0 && (
              <div
                style={{
                  padding: '28px 16px',
                  textAlign: 'center',
                  color: 'var(--z-text-muted)',
                  fontSize: 'var(--z-fs-sm)',
                }}
              >
                <div style={{ fontSize: 28, marginBottom: 8 }}>🌱</div>
                Пока тихо. Здесь появятся лайки, ответы и побитые рекорды.
              </div>
            )}
            {items?.map((notification) => (
              <NotificationRow
                key={notification.id}
                notification={notification}
                onClick={() => openNotification(notification)}
              />
            ))}
          </div>

          <Link href="/notifications" className="z-notif-panel-foot" onClick={() => setOpen(false)}>
            Все уведомления →
          </Link>
        </div>
      )}
    </div>
  );
}
