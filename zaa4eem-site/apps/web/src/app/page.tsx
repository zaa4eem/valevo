'use client';

import { useState } from 'react';
import type { Comment, Post } from '@zaa4eem/shared';
import { formatMemberNumber } from '@zaa4eem/shared';
import { useApiData } from '@/lib/use-api-data';
import { api, ApiError } from '@/lib/api-client';
import { useAuth } from '@/lib/auth-context';
import { Card } from '@/components/Card';
import { Avatar } from '@/components/Avatar';

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', year: 'numeric' });
}

function Composer({ onPosted }: { onPosted: (post: Post) => void }) {
  const { user } = useAuth();
  const [body, setBody] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [focused, setFocused] = useState(false);

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

  if (!user) return null;

  return (
    <Card className="z-animate-in" hover>
      <form onSubmit={submit} style={{ display: 'flex', gap: 12 }}>
        <Avatar name={user.displayName} avatarUrl={user.avatarUrl} ring />
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 10 }}>
          <textarea
            className="z-textarea"
            rows={focused || body ? 3 : 1}
            placeholder="Что нового? 🟢"
            value={body}
            onChange={(e) => setBody(e.target.value)}
            onFocus={() => setFocused(true)}
            maxLength={5000}
            style={{ resize: 'none', border: 'none', background: 'var(--z-bg-elevated)' }}
          />
          {error && <div style={{ color: 'var(--z-danger)', fontSize: 'var(--z-fs-sm)' }}>{error}</div>}
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span style={{ fontSize: 'var(--z-fs-xs)', color: 'var(--z-text-faint)' }}>
              {user.role === 'OWNER' ? 'Без ограничений' : 'Раз в 12 часов'}
            </span>
            <button
              type="submit"
              className="z-btn-accent z-pop-on-active"
              disabled={busy || !body.trim()}
              style={{ opacity: busy || !body.trim() ? 0.6 : 1 }}
            >
              {busy ? 'Публикация…' : 'Опубликовать 🚀'}
            </button>
          </div>
        </div>
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
    <div className="z-animate-fade" style={{ marginTop: 14, paddingTop: 14, borderTop: '1px dashed var(--z-border)' }}>
      {error && <p style={{ color: 'var(--z-danger)', fontSize: 'var(--z-fs-sm)' }}>Не удалось загрузить комментарии.</p>}
      {!error && list === null && <p style={{ color: 'var(--z-text-muted)', fontSize: 'var(--z-fs-sm)' }}>Загрузка…</p>}
      {list && list.length === 0 && (
        <p style={{ color: 'var(--z-text-faint)', fontSize: 'var(--z-fs-sm)' }}>Пока нет комментариев — будь первым.</p>
      )}
      {list && list.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginBottom: 12 }}>
          {list.map((comment) => (
            <div key={comment.id} style={{ display: 'flex', gap: 8, alignItems: 'flex-start' }}>
              <Avatar name={comment.author.displayName} size={26} />
              <div
                style={{
                  background: 'var(--z-bg-elevated)',
                  border: '1px solid var(--z-border)',
                  borderRadius: 'var(--z-radius-sm)',
                  padding: '6px 10px',
                  flex: 1,
                }}
              >
                <span style={{ fontWeight: 700, fontSize: 'var(--z-fs-sm)', marginRight: 6 }}>
                  {comment.author.displayName}
                </span>
                <span style={{ fontSize: 'var(--z-fs-xs)', color: 'var(--z-text-faint)' }}>
                  {formatMemberNumber(comment.author.memberNumber)}
                </span>
                <div style={{ fontSize: 'var(--z-fs-sm)', color: 'var(--z-text-muted)' }}>{comment.body}</div>
                {comment.moderationState === 'PENDING_REVIEW' && (
                  <span style={{ fontSize: 'var(--z-fs-xs)', color: 'var(--z-warning)' }}>на проверке</span>
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
        <button type="submit" className="z-btn-ghost z-pop-on-active" disabled={busy}>
          Отправить
        </button>
      </form>
      {formError && <div style={{ color: 'var(--z-danger)', fontSize: 'var(--z-fs-xs)', marginTop: 6 }}>{formError}</div>}
    </div>
  );
}

function PostCard({ post, onChange, index }: { post: Post; onChange: (post: Post) => void; index: number }) {
  const { user } = useAuth();
  const [showComments, setShowComments] = useState(false);
  const [busy, setBusy] = useState(false);
  const isOwner = post.author.role === 'OWNER';

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
    <Card
      hover
      className="z-animate-in"
      style={{
        animationDelay: `${Math.min(index, 8) * 45}ms`,
        borderLeft: isOwner ? '3px solid var(--z-accent)' : undefined,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12 }}>
        <Avatar name={post.author.displayName} avatarUrl={post.author.avatarUrl} ring={isOwner} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
            <span style={{ fontWeight: 700 }}>{post.author.displayName}</span>
            {isOwner && <span className="z-badge">Owner</span>}
            <span style={{ fontSize: 'var(--z-fs-xs)', color: 'var(--z-text-faint)' }}>
              {formatMemberNumber(post.author.memberNumber)}
            </span>
          </div>
          <div style={{ fontSize: 'var(--z-fs-xs)', color: 'var(--z-text-faint)' }}>
            {post.publishedAt ? formatDate(post.publishedAt) : ''}
          </div>
        </div>
      </div>
      <p style={{ whiteSpace: 'pre-wrap', margin: 0, lineHeight: 1.55 }}>{post.body}</p>
      <div style={{ display: 'flex', gap: 8, marginTop: 14, paddingTop: 12, borderTop: '1px solid var(--z-border)' }}>
        <button
          onClick={toggleLike}
          disabled={!user}
          className="z-btn-ghost z-pop-on-active"
          style={{
            color: post.viewerHasLiked ? 'var(--z-accent)' : undefined,
            borderColor: post.viewerHasLiked ? 'var(--z-accent)' : undefined,
            transform: post.viewerHasLiked ? 'scale(1.03)' : 'scale(1)',
            transition: 'transform .25s cubic-bezier(0.34, 1.56, 0.64, 1), color .2s ease, border-color .2s ease',
          }}
        >
          {post.viewerHasLiked ? '💚' : '🤍'} {post.likeCount}
        </button>
        <button
          onClick={() => setShowComments((s) => !s)}
          className="z-btn-ghost z-pop-on-active"
          style={{ color: showComments ? 'var(--z-text)' : undefined }}
        >
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
      <Card
        className="z-animate-in"
        style={{
          marginBottom: 20,
          background: 'linear-gradient(135deg, var(--z-surface) 0%, var(--z-accent-soft) 140%)',
          position: 'relative',
          overflow: 'hidden',
        }}
      >
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
          Лента
        </div>
        <h1 style={{ fontSize: 'var(--z-fs-3xl)', margin: 0, fontWeight: 900, lineHeight: 1.05 }}>
          ZAA<span className="z-accent-text">4</span>EEM
        </h1>
        <p style={{ color: 'var(--z-text-muted)', margin: '8px 0 0', fontSize: 'var(--z-fs-sm)' }}>
          Всё новое появляется здесь — публикуй, лайкай, обсуждай.
        </p>
      </Card>

      <div style={{ marginBottom: 16 }}>
        <Composer onPosted={prependPost} />
      </div>

      {error ? (
        <p style={{ color: 'var(--z-danger)' }}>Не удалось загрузить ленту. Попробуйте обновить страницу.</p>
      ) : list === null ? (
        <p style={{ color: 'var(--z-text-muted)' }}>Загрузка…</p>
      ) : list.length === 0 ? (
        <Card className="z-animate-in" style={{ textAlign: 'center', padding: 40 }}>
          <div style={{ fontSize: 40, marginBottom: 8 }}>🟢</div>
          <p style={{ color: 'var(--z-text-muted)', margin: 0 }}>
            {user ? 'Пока нет постов — напиши первый!' : 'Пока нет постов — загляни чуть позже.'}
          </p>
        </Card>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          {list.map((post, i) => (
            <PostCard key={post.id} post={post} onChange={replacePost} index={i} />
          ))}
        </div>
      )}
    </div>
  );
}
