'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import type { PendingScroll } from '@zaa4eem/shared';
import { api, getApiBase } from '@/lib/api-client';
import { useToast } from '@/lib/toast-context';
import { Card } from '@/components/Card';
import { EmptyState } from '@/components/EmptyState';

function mediaUrl(url: string) {
  if (!url || /^https?:\/\//.test(url)) return url;
  return `${getApiBase().replace(/\/api$/, '')}${url}`;
}

export default function AdminScrollsPage() {
  const { toast, prompt } = useToast();
  const [items, setItems] = useState<PendingScroll[] | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setItems(await api.get<PendingScroll[]>('/scrolls/moderation/queue'));
    } catch {
      setItems([]);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  // Clips arrive in the queue only once ffmpeg has finished with them, so
  // the queue keeps refreshing itself while anything is still processing.
  useEffect(() => {
    if (!items?.some((s) => s.status === 'PROCESSING')) return;
    const timer = setInterval(load, 4000);
    return () => clearInterval(timer);
  }, [items, load]);

  async function review(scroll: PendingScroll, approve: boolean) {
    let reason: string | undefined;
    if (!approve) {
      // The uploader is shown this verbatim, so it is asked for rather than
      // defaulted — "не прошло модерацию" tells them nothing.
      const answer = await prompt('Почему отклоняем? Автор увидит эту причину.', {
        placeholder: 'Например: не по теме',
      });
      if (answer === null) return;
      reason = answer;
    }
    setBusyId(scroll.id);
    try {
      await api.post(`/scrolls/moderation/${scroll.id}`, { approve, reason });
      setItems((current) => (current ?? []).filter((s) => s.id !== scroll.id));
      toast(approve ? 'Опубликовано' : 'Отклонено', 'success');
    } catch {
      toast('Не удалось — попробуйте ещё раз', 'error');
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div>
      <h1 style={{ fontSize: 'var(--z-fs-2xl)', marginTop: 0 }}>Scrolls на модерации</h1>
      <p style={{ color: 'var(--z-text-muted)', fontSize: 'var(--z-fs-sm)', marginTop: 0 }}>
        Ни один ролик не виден в ленте, пока его не посмотрит человек.
      </p>

      {items === null ? (
        <p style={{ color: 'var(--z-text-muted)' }}>Загрузка…</p>
      ) : items.length === 0 ? (
        <EmptyState icon="✅" description="Очередь пуста — всё просмотрено." />
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))', gap: 16 }}>
          {items.map((scroll) => (
            <Card key={scroll.id} style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {scroll.status === 'PROCESSING' ? (
                <div
                  style={{
                    height: 320,
                    borderRadius: 'var(--z-radius-sm)',
                    background: 'var(--z-bg-elevated)',
                    display: 'grid',
                    placeItems: 'center',
                    color: 'var(--z-text-faint)',
                    fontSize: 'var(--z-fs-sm)',
                  }}
                >
                  Обрабатывается…
                </div>
              ) : (
                // The moderator watches the transcoded file — the same one
                // viewers would get, not the original upload.
                // eslint-disable-next-line jsx-a11y/media-has-caption
                <video
                  src={mediaUrl(scroll.videoUrl)}
                  poster={mediaUrl(scroll.posterUrl)}
                  controls
                  playsInline
                  preload="metadata"
                  style={{ width: '100%', height: 320, objectFit: 'contain', background: '#000', borderRadius: 'var(--z-radius-sm)' }}
                />
              )}

              <div style={{ fontSize: 'var(--z-fs-sm)' }}>
                <Link href={`/u/${scroll.author.id}`} style={{ fontWeight: 700 }}>
                  {scroll.author.displayName}
                </Link>
                {scroll.authorEmail && (
                  <span style={{ color: 'var(--z-text-faint)', fontSize: 'var(--z-fs-xs)' }}> · {scroll.authorEmail}</span>
                )}
              </div>
              {scroll.caption && (
                <p style={{ margin: 0, fontSize: 'var(--z-fs-sm)', color: 'var(--z-text-muted)' }}>{scroll.caption}</p>
              )}
              <div style={{ fontSize: 'var(--z-fs-xs)', color: 'var(--z-text-faint)' }}>
                {Math.round(scroll.durationMs / 1000)} сек · {scroll.width}×{scroll.height} ·{' '}
                {new Date(scroll.createdAt).toLocaleString('ru-RU', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}
              </div>

              <div style={{ display: 'flex', gap: 8, marginTop: 'auto' }}>
                <button
                  type="button"
                  onClick={() => review(scroll, true)}
                  disabled={busyId === scroll.id || scroll.status === 'PROCESSING'}
                  className="z-btn-accent z-pop-on-active"
                  style={{ flex: 1 }}
                >
                  Опубликовать
                </button>
                <button
                  type="button"
                  onClick={() => review(scroll, false)}
                  disabled={busyId === scroll.id || scroll.status === 'PROCESSING'}
                  className="z-btn-danger z-pop-on-active"
                  style={{ flex: 1 }}
                >
                  Отклонить
                </button>
              </div>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
