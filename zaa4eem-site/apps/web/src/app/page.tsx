'use client';

import { useState } from 'react';
import type { Comment, Post } from '@zaa4eem/shared';
import { useApiData } from '@/lib/use-api-data';
import { api, ApiError } from '@/lib/api-client';
import { useAuth } from '@/lib/auth-context';
import { Card } from '@/components/Card';

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', year: 'numeric' });
}

function Avatar({ name, size = 32 }: { name: string; size?: number }) {
  return (
    <div
      style={{
        width: size,
        height: size,
        borderRadius: '50%',
        background: 'var(--z-accent-soft)',
        display: 'grid',
        placeItems: 'center',
        fontWeight: 800,
        color: 'var(--z-accent)',
        flexShrink: 0,
      }}
    >
      {name.charAt(0).toUpperCase()}
    </div>
  );
}

function Composer({ onPosted }: { onPosted: (post: Post) => void }) {
  const [body, setBody] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!body.trim()) return;
    setBusy(true);
    setError(null);
    try {
      const post = await api.post<Post>('/posts', { body: body.trim(), publish: true });
      setBody('');
      onPosted(post);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Не удалось опубликовать пост');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card>
      <form onSubmit={submit} style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        <textarea
          className="z-textarea"
          rows={3}
          placeholder="Что нового?"
          value={body}
          onChange={(e) => setBody(e.target.value)}
          maxLength={5000}
        />
        {error && <div style={{ color: 'var(--z-danger)', fontSize: 'var(--z-fs-sm)' }}>{error}</div>}
        <button type="submit" className="z-btn-accent" disabled={busy} style={{ alignSelf: 'flex-start' }}>
          {busy ? 'Публикация…' : 'Опубликовать'}
        </button>
      </form>
    </Card>
  );
}

function CommentThread({ postId }: { postId: string }) {
  const { data: comments, error } = useApiData<Comment[]>(`/posts/${postId}/comments`, [postId]);
  const [items, setItems] = useState<Comment[] | null>(null);
  const [body, setBody] = useState('');
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const list = items ?? comments;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!body.trim()) return;
    setBusy(true);
    setFormError(null);
    try {
      const comment = await api.post<Comment>(`/posts/${postId}/comments`, { body: body.trim() });
      setItems([...(list ?? []), comment]);
      setBody('');
    } catch (err) {
      setFormError(err instanceof ApiError ? err.message : 'Не удалось отправить комментарий');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div style={{ marginTop: 12, paddingTop: 12, borderTop: '1px solid var(--z-border)' }}>
      {error && <p style={{ color: 'var(--z-danger)', fontSize: 'var(--z-fs-sm)' }}>Не удалось загрузить комментарии.</p>}
      {!error && list === null && <p style={{ color: 'var(--z-text-muted)', fontSize: 'var(--z-fs-sm)' }}>Загрузка…</p>}
      {list && list.length === 0 && (
        <p style={{ color: 'var(--z-text-faint)', fontSize: 'var(--z-fs-sm)' }}>Пока нет комментариев.</p>
      )}
      {list && list.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 10 }}>
          {list.map((comment) => (
            <div key={comment.id} style={{ display: 'flex', gap: 8, alignItems: 'flex-start' }}>
              <Avatar name={comment.author.displayName} size={24} />
              <div>
                <span style={{ fontWeight: 700, fontSize: 'var(--z-fs-sm)', marginRight: 6 }}>
                  {comment.author.displayName}
                </span>
                <span style={{ fontSize: 'var(--z-fs-sm)', color: 'var(--z-text-muted)' }}>{comment.body}</span>
                {comment.moderationState === 'PENDING_REVIEW' && (
                  <span style={{ marginLeft: 6, fontSize: 'var(--z-fs-xs)', color: 'var(--z-warning)' }}>
                    на проверке
                  </span>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
      <form onSubmit={submit} style={{ display: 'flex', gap: 8 }}>
        <input
          className="z-input"
          placeholder="Написать комментарий…"
          value={body}
          onChange={(e) => setBody(e.target.value)}
          maxLength={1000}
        />
        <button type="submit" className="z-btn-ghost" disabled={busy}>
          Отправить
        </button>
      </form>
      {formError && <div style={{ color: 'var(--z-danger)', fontSize: 'var(--z-fs-xs)', marginTop: 6 }}>{formError}</div>}
    </div>
  );
}

function PostCard({ post, onChange }: { post: Post; onChange: (post: Post) => void }) {
  const { user } = useAuth();
  const [showComments, setShowComments] = useState(false);
  const [busy, setBusy] = useState(false);

  async function toggleLike() {
    if (!user || busy) return;
    setBusy(true);
    const wasLiked = post.viewerHasLiked;
    onChange({
      ...post,
      viewerHasLiked: !wasLiked,
      likeCount: post.likeCount + (wasLiked ? -1 : 1),
    });
    try {
      if (wasLiked) await api.delete(`/posts/${post.id}/like`);
      else await api.post(`/posts/${post.id}/like`);
    } catch {
      onChange(post);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10 }}>
        <Avatar name={post.author.displayName} />
        <div>
          <div style={{ fontWeight: 700 }}>{post.author.displayName}</div>
          <div style={{ fontSize: 'var(--z-fs-xs)', color: 'var(--z-text-faint)' }}>
            {post.publishedAt ? formatDate(post.publishedAt) : ''}
          </div>
        </div>
      </div>
      <p style={{ whiteSpace: 'pre-wrap', margin: 0 }}>{post.body}</p>
      <div style={{ display: 'flex', gap: 16, marginTop: 12 }}>
        <button
          onClick={toggleLike}
          disabled={!user}
          className="z-btn-ghost"
          style={{ color: post.viewerHasLiked ? 'var(--z-accent)' : undefined }}
        >
          {post.viewerHasLiked ? '💚' : '🤍'} {post.likeCount}
        </button>
        <button onClick={() => setShowComments((s) => !s)} className="z-btn-ghost">
          💬 {post.commentCount}
        </button>
      </div>
      {showComments && <CommentThread postId={post.id} />}
    </Card>
  );
}

export default function HomeFeedPage() {
  const { user } = useAuth();
  const { data: fetched, error } = useApiData<Post[]>('/posts');
  const [posts, setPosts] = useState<Post[] | null>(null);
  const list = posts ?? fetched;

  function replacePost(updated: Post) {
    setPosts((list ?? []).map((p) => (p.id === updated.id ? updated : p)));
  }

  function prependPost(post: Post) {
    setPosts([post, ...(list ?? [])]);
  }

  return (
    <div style={{ maxWidth: 640, margin: '0 auto' }}>
      <div style={{ marginBottom: 24 }}>
        <h1 style={{ fontSize: 'var(--z-fs-3xl)', margin: 0, fontWeight: 900 }}>
          ZAA<span className="z-accent-text">4</span>EEM
        </h1>
      </div>

      {user && (
        <div style={{ marginBottom: 16 }}>
          <Composer onPosted={prependPost} />
        </div>
      )}

      {error ? (
        <p style={{ color: 'var(--z-danger)' }}>Не удалось загрузить ленту. Попробуйте обновить страницу.</p>
      ) : list === null ? (
        <p style={{ color: 'var(--z-text-muted)' }}>Загрузка…</p>
      ) : list.length === 0 ? (
        <p style={{ color: 'var(--z-text-muted)' }}>Пока нет постов — скоро здесь появятся новости.</p>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          {list.map((post) => (
            <PostCard key={post.id} post={post} onChange={replacePost} />
          ))}
        </div>
      )}
    </div>
  );
}
