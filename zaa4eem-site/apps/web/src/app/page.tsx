'use client';

import { useCallback, useEffect, useState } from 'react';
import type { Comment, PaginatedPosts, Post } from '@zaa4eem/shared';
import { formatMemberNumber } from '@zaa4eem/shared';
import { useApiData } from '@/lib/use-api-data';
import { api, ApiError } from '@/lib/api-client';
import { useAuth } from '@/lib/auth-context';
import { haptic, hapticNotify } from '@/lib/telegram';
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
      hapticNotify('success');
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Не удалось опубликовать пост');
      hapticNotify('error');
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
  const { user } = useAuth();
  const { data: comments, error } = useApiData<Comment[]>(`/posts/${postId}/comments`, [postId]);
  const [items, setItems] = useState<Comment[] | null>(null);
  const [body, setBody] = useState('');
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);

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
      haptic('light');
    } catch (err) {
      setFormError(err instanceof ApiError ? err.message : 'Не удалось отправить комментарий');
    } finally {
      setBusy(false);
    }
  }

  async function removeComment(commentId: string) {
    if (!window.confirm('Удалить комментарий?')) return;
    setDeletingId(commentId);
    try {
      await api.delete(`/posts/${postId}/comments/${commentId}`);
      setItems((list ?? []).filter((c) => c.id !== commentId));
    } catch {
      // Leave the comment in place — the click can simply be retried.
    } finally {
      setDeletingId(null);
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
          {list.map((comment) => {
            const canDelete = user && (user.id === comment.author.id || user.role === 'OWNER');
            return (
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
                  <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 8 }}>
                    <div>
                      <span style={{ fontWeight: 700, fontSize: 'var(--z-fs-sm)', marginRight: 6 }}>
                        {comment.author.displayName}
                      </span>
                      <span style={{ fontSize: 'var(--z-fs-xs)', color: 'var(--z-text-faint)' }}>
                        {formatMemberNumber(comment.author.memberNumber)}
                      </span>
                    </div>
                    {canDelete && (
                      <button
                        onClick={() => removeComment(comment.id)}
                        disabled={deletingId === comment.id}
                        className="z-pop-on-active"
                        title="Удалить комментарий"
                        style={{
                          background: 'none',
                          border: 'none',
                          cursor: 'pointer',
                          color: 'var(--z-text-faint)',
                          fontSize: 'var(--z-fs-xs)',
                          padding: 0,
                          flexShrink: 0,
                        }}
                      >
                        ✕
                      </button>
                    )}
                  </div>
                  <div style={{ fontSize: 'var(--z-fs-sm)', color: 'var(--z-text-muted)' }}>{comment.body}</div>
                  {comment.moderationState === 'PENDING_REVIEW' && (
                    <span style={{ fontSize: 'var(--z-fs-xs)', color: 'var(--z-warning)' }}>на проверке</span>
                  )}
                </div>
              </div>
            );
          })}
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

function PostCard({
  post,
  onChange,
  onDelete,
  onToggleFollowAuthor,
  index,
}: {
  post: Post;
  onChange: (post: Post) => void;
  onDelete: (postId: string) => void;
  onToggleFollowAuthor: (authorId: string, currentlyFollowing: boolean) => void;
  index: number;
}) {
  const { user } = useAuth();
  const [showComments, setShowComments] = useState(false);
  const [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(post.body);
  const [saving, setSaving] = useState(false);
  const [editError, setEditError] = useState<string | null>(null);
  const isOwner = post.author.role === 'OWNER';
  const isOwnPost = user?.id === post.author.id;
  const canManage = user && (isOwnPost || user.role === 'OWNER');

  async function toggleLike() {
    if (!user || busy) return;
    setBusy(true);
    haptic('light');
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

  async function saveEdit() {
    if (!draft.trim()) return;
    setSaving(true);
    setEditError(null);
    try {
      const updated = await api.patch<Post>(`/posts/${post.id}`, { body: draft.trim() });
      onChange({ ...post, ...updated });
      setEditing(false);
    } catch (err) {
      setEditError(err instanceof ApiError ? err.message : 'Не удалось сохранить изменения');
    } finally {
      setSaving(false);
    }
  }

  async function removePost() {
    if (!window.confirm('Удалить пост? Это действие нельзя отменить.')) return;
    try {
      await api.delete(`/posts/${post.id}`);
      onDelete(post.id);
    } catch {
      // Leave the post in place — the click can simply be retried.
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
            {user && !isOwnPost && (
              <button
                onClick={() => onToggleFollowAuthor(post.author.id, Boolean(post.author.viewerIsFollowing))}
                className="z-pop-on-active"
                style={{
                  fontSize: 'var(--z-fs-xs)',
                  fontWeight: 700,
                  padding: '2px 9px',
                  borderRadius: 999,
                  border: `1px solid ${post.author.viewerIsFollowing ? 'var(--z-border)' : 'var(--z-accent)'}`,
                  background: post.author.viewerIsFollowing ? 'transparent' : 'var(--z-accent-soft)',
                  color: post.author.viewerIsFollowing ? 'var(--z-text-faint)' : 'var(--z-accent)',
                  cursor: 'pointer',
                }}
              >
                {post.author.viewerIsFollowing ? 'Подписан' : '+ Подписаться'}
              </button>
            )}
          </div>
          <div style={{ fontSize: 'var(--z-fs-xs)', color: 'var(--z-text-faint)' }}>
            {post.publishedAt ? formatDate(post.publishedAt) : ''}
          </div>
        </div>
        {canManage && !editing && (
          <div style={{ display: 'flex', gap: 6, flexShrink: 0 }}>
            <button
              onClick={() => {
                setDraft(post.body);
                setEditError(null);
                setEditing(true);
              }}
              className="z-btn-ghost z-pop-on-active"
              title="Редактировать"
              style={{ padding: '4px 10px', fontSize: 'var(--z-fs-xs)' }}
            >
              ✎
            </button>
            <button
              onClick={removePost}
              className="z-btn-ghost z-pop-on-active"
              title="Удалить"
              style={{ padding: '4px 10px', fontSize: 'var(--z-fs-xs)', color: 'var(--z-danger)' }}
            >
              🗑
            </button>
          </div>
        )}
      </div>
      {editing ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <textarea
            className="z-textarea"
            rows={3}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            maxLength={5000}
            style={{ resize: 'none' }}
            autoFocus
          />
          {editError && <div style={{ color: 'var(--z-danger)', fontSize: 'var(--z-fs-sm)' }}>{editError}</div>}
          <div style={{ display: 'flex', gap: 8 }}>
            <button
              onClick={saveEdit}
              disabled={saving || !draft.trim()}
              className="z-btn-accent z-pop-on-active"
              style={{ opacity: saving || !draft.trim() ? 0.6 : 1 }}
            >
              {saving ? 'Сохранение…' : 'Сохранить'}
            </button>
            <button onClick={() => setEditing(false)} disabled={saving} className="z-btn-ghost z-pop-on-active">
              Отмена
            </button>
          </div>
        </div>
      ) : (
        <p style={{ whiteSpace: 'pre-wrap', margin: 0, lineHeight: 1.55 }}>{post.body}</p>
      )}
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
  const [list, setList] = useState<Post[] | null>(null);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [error, setError] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);

  const loadFirstPage = useCallback(async () => {
    setError(false);
    try {
      const page = await api.get<PaginatedPosts>('/posts');
      setList(page.items);
      setNextCursor(page.nextCursor);
    } catch {
      setError(true);
    }
  }, []);

  useEffect(() => {
    loadFirstPage();
  }, [loadFirstPage]);

  async function loadMore() {
    if (!nextCursor || loadingMore) return;
    setLoadingMore(true);
    try {
      const page = await api.get<PaginatedPosts>(`/posts?cursor=${nextCursor}`);
      setList([...(list ?? []), ...page.items]);
      setNextCursor(page.nextCursor);
    } catch {
      // Leave the loaded posts as-is — the "Показать ещё" button stays put
      // so the viewer can simply try again instead of losing their scroll spot.
    } finally {
      setLoadingMore(false);
    }
  }

  function replacePost(updated: Post) {
    setList((list ?? []).map((p) => (p.id === updated.id ? updated : p)));
  }

  function prependPost(post: Post) {
    setList([post, ...(list ?? [])]);
  }

  function removePostFromList(postId: string) {
    setList((list ?? []).filter((p) => p.id !== postId));
  }

  function setFollowingForAuthor(authorId: string, isFollowing: boolean) {
    setList(
      (list ?? []).map((p) =>
        p.author.id === authorId ? { ...p, author: { ...p.author, viewerIsFollowing: isFollowing } } : p,
      ),
    );
  }

  async function toggleFollowAuthor(authorId: string, currentlyFollowing: boolean) {
    // Every post by this author flips together — the feed can show several
    // posts from the same person, and only one follow state exists for them.
    haptic('light');
    setFollowingForAuthor(authorId, !currentlyFollowing);
    try {
      if (currentlyFollowing) await api.delete(`/users/${authorId}/follow`);
      else await api.post(`/users/${authorId}/follow`);
    } catch {
      setFollowingForAuthor(authorId, currentlyFollowing);
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
            <PostCard
              key={post.id}
              post={post}
              onChange={replacePost}
              onDelete={removePostFromList}
              onToggleFollowAuthor={toggleFollowAuthor}
              index={i}
            />
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
