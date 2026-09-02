'use client';

import type { Post } from '@zaa4eem/shared';
import { useApiData } from '@/lib/use-api-data';
import { Card } from '@/components/Card';

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', year: 'numeric' });
}

export default function HomeFeedPage() {
  const { data: posts, error } = useApiData<Post[]>('/posts');

  return (
    <div style={{ maxWidth: 640, margin: '0 auto' }}>
      <div style={{ marginBottom: 24 }}>
        <div className="z-square-bullet" style={{ color: 'var(--z-accent)', fontSize: 'var(--z-fs-xs)', fontWeight: 700, letterSpacing: 1 }}>
          NO SIGNAL · STILL HERE
        </div>
        <h1 style={{ fontSize: 'var(--z-fs-3xl)', margin: '8px 0 4px', fontWeight: 900 }}>
          ZAA<span className="z-accent-text">4</span>EEM
        </h1>
        <p style={{ color: 'var(--z-text-muted)' }}>комьюнити · стримы · squad</p>
      </div>

      {error ? (
        <p style={{ color: 'var(--z-danger)' }}>Не удалось загрузить ленту. Попробуйте обновить страницу.</p>
      ) : posts === null ? (
        <p style={{ color: 'var(--z-text-muted)' }}>Загрузка…</p>
      ) : posts.length === 0 ? (
        <p style={{ color: 'var(--z-text-muted)' }}>Пока нет постов — скоро здесь появятся новости.</p>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          {posts.map((post) => (
            <Card key={post.id}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10 }}>
                <div
                  style={{
                    width: 32,
                    height: 32,
                    borderRadius: '50%',
                    background: 'var(--z-accent-soft)',
                    display: 'grid',
                    placeItems: 'center',
                    fontWeight: 800,
                    color: 'var(--z-accent)',
                  }}
                >
                  {post.author.displayName.charAt(0).toUpperCase()}
                </div>
                <div>
                  <div style={{ fontWeight: 700 }}>{post.author.displayName}</div>
                  <div style={{ fontSize: 'var(--z-fs-xs)', color: 'var(--z-text-faint)' }}>
                    {post.publishedAt ? formatDate(post.publishedAt) : ''}
                  </div>
                </div>
              </div>
              <p style={{ whiteSpace: 'pre-wrap', margin: 0 }}>{post.body}</p>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
