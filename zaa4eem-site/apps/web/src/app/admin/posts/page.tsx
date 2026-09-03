'use client';

import { useCallback, useEffect, useState } from 'react';
import type { PaginatedPosts, Post } from '@zaa4eem/shared';
import { api } from '@/lib/api-client';
import { Card } from '@/components/Card';

export default function AdminPostsPage() {
  const [posts, setPosts] = useState<Post[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const [body, setBody] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const load = useCallback(async () => {
    const page = await api.get<PaginatedPosts>('/posts?limit=50');
    setPosts(page.items);
    setNextCursor(page.nextCursor);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function loadMore() {
    if (!nextCursor || loadingMore) return;
    setLoadingMore(true);
    try {
      const page = await api.get<PaginatedPosts>(`/posts?limit=50&cursor=${nextCursor}`);
      setPosts((prev) => [...prev, ...page.items]);
      setNextCursor(page.nextCursor);
    } finally {
      setLoadingMore(false);
    }
  }

  async function publish(e: React.FormEvent) {
    e.preventDefault();
    if (!body.trim()) return;
    setSubmitting(true);
    try {
      await api.post('/posts', { body, publish: true });
      setBody('');
      load();
    } finally {
      setSubmitting(false);
    }
  }

  async function remove(id: string) {
    await api.delete(`/posts/${id}`);
    load();
  }

  return (
    <div>
      <h1 style={{ marginTop: 0 }}>Лента — управление</h1>
      <Card>
        <form onSubmit={publish} style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <textarea
            className="z-textarea"
            rows={4}
            placeholder="Что нового?"
            value={body}
            onChange={(e) => setBody(e.target.value)}
          />
          <button type="submit" className="z-btn-accent" disabled={submitting} style={{ alignSelf: 'flex-start' }}>
            Опубликовать
          </button>
        </form>
      </Card>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginTop: 16 }}>
        {posts.map((post) => (
          <Card key={post.id}>
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12 }}>
              <p style={{ margin: 0, whiteSpace: 'pre-wrap' }}>{post.body}</p>
              <button className="z-btn-danger" onClick={() => remove(post.id)}>
                Удалить
              </button>
            </div>
          </Card>
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
    </div>
  );
}
