'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import type { MyScroll } from '@zaa4eem/shared';
import { api, getApiBase } from '@/lib/api-client';
import { useAuth } from '@/lib/auth-context';
import { useToast } from '@/lib/toast-context';
import { Card } from '@/components/Card';
import { EmptyState } from '@/components/EmptyState';

const STATUS_LABEL: Record<string, { text: string; tone: string }> = {
  PROCESSING: { text: 'Обрабатывается', tone: 'var(--z-text-muted)' },
  PENDING_REVIEW: { text: 'На модерации', tone: 'var(--z-warning, #fbbf24)' },
  PUBLISHED: { text: 'Опубликован', tone: 'var(--z-accent)' },
  REJECTED: { text: 'Отклонён', tone: 'var(--z-danger)' },
  FAILED: { text: 'Не обработался', tone: 'var(--z-danger)' },
};

function mediaUrl(url: string) {
  if (!url || /^https?:\/\//.test(url)) return url;
  return `${getApiBase().replace(/\/api$/, '')}${url}`;
}

export default function MyScrollsPage() {
  const { user } = useAuth();
  const { toast, confirm } = useToast();
  const [items, setItems] = useState<MyScroll[] | null>(null);

  const load = useCallback(async () => {
    try {
      setItems(await api.get<MyScroll[]>('/scrolls/mine'));
    } catch {
      setItems([]);
    }
  }, []);

  useEffect(() => {
    if (user) load();
  }, [user, load]);

  /**
   * Transcoding happens in the background, so a freshly uploaded clip sits
   * at PROCESSING until ffmpeg is done. Polling only while something is
   * actually processing means the page is not making requests for nothing
   * the rest of the time.
   */
  useEffect(() => {
    if (!items?.some((s) => s.status === 'PROCESSING')) return;
    const timer = setInterval(load, 4000);
    return () => clearInterval(timer);
  }, [items, load]);

  async function remove(scroll: MyScroll) {
    if (!(await confirm('Удалить ролик? Это навсегда.', { danger: true, confirmLabel: 'Удалить' }))) return;
    try {
      await api.delete(`/scrolls/${scroll.id}`);
      setItems((current) => (current ?? []).filter((s) => s.id !== scroll.id));
    } catch {
      toast('Не удалось удалить', 'error');
    }
  }

  if (!user) {
    return (
      <Card style={{ maxWidth: 520, margin: '0 auto', textAlign: 'center' }}>
        <p style={{ color: 'var(--z-text-muted)' }}>Войдите, чтобы увидеть свои ролики.</p>
        <Link href="/login" className="z-btn-accent z-pop-on-active">
          Войти
        </Link>
      </Card>
    );
  }

  return (
    <div style={{ maxWidth: 640, margin: '0 auto' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 14 }}>
        <h1 style={{ fontSize: 'var(--z-fs-2xl)', margin: 0 }}>Мои Scrolls</h1>
        <Link
          href="/scrolls/upload"
          className="z-btn-accent z-pop-on-active"
          style={{ marginLeft: 'auto', fontSize: 'var(--z-fs-xs)', padding: '6px 12px' }}
        >
          + Загрузить
        </Link>
      </div>

      {items === null ? (
        <p style={{ color: 'var(--z-text-muted)' }}>Загрузка…</p>
      ) : items.length === 0 ? (
        <EmptyState
          icon="🎬"
          description="Тут появятся твои ролики — и те, что ещё на проверке."
          action={
            <Link href="/scrolls/upload" className="z-btn-accent z-pop-on-active">
              Загрузить первый
            </Link>
          }
        />
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {items.map((scroll) => {
            const status = STATUS_LABEL[scroll.status] ?? { text: scroll.status, tone: 'var(--z-text-muted)' };
            return (
              <Card key={scroll.id} style={{ display: 'flex', gap: 12, alignItems: 'flex-start' }}>
                <div
                  style={{
                    width: 64,
                    height: 96,
                    borderRadius: 'var(--z-radius-sm)',
                    background: '#000',
                    flexShrink: 0,
                    overflow: 'hidden',
                    display: 'grid',
                    placeItems: 'center',
                    fontSize: 22,
                  }}
                >
                  {scroll.posterUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={mediaUrl(scroll.posterUrl)}
                      alt=""
                      style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                    />
                  ) : (
                    '⏳'
                  )}
                </div>

                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontWeight: 700, color: status.tone, fontSize: 'var(--z-fs-sm)' }}>{status.text}</div>
                  {scroll.caption && (
                    <p style={{ margin: '4px 0 0', fontSize: 'var(--z-fs-sm)', color: 'var(--z-text-muted)' }}>
                      {scroll.caption}
                    </p>
                  )}
                  {scroll.rejectionReason && (
                    <p style={{ margin: '4px 0 0', fontSize: 'var(--z-fs-xs)', color: 'var(--z-danger)' }}>
                      {scroll.rejectionReason}
                    </p>
                  )}
                  {scroll.status === 'PUBLISHED' && (
                    <div style={{ marginTop: 4, fontSize: 'var(--z-fs-xs)', color: 'var(--z-text-faint)' }}>
                      {scroll.viewCount} просмотров · {scroll.likeCount} ❤ · {scroll.commentCount} 💬
                    </div>
                  )}
                </div>

                <button
                  type="button"
                  onClick={() => remove(scroll)}
                  className="z-btn-ghost z-pop-on-active"
                  style={{ fontSize: 'var(--z-fs-xs)', padding: '4px 10px', flexShrink: 0 }}
                >
                  Удалить
                </button>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
