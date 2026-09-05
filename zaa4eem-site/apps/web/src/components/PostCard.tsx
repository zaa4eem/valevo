'use client';

import { useState } from 'react';
import Link from 'next/link';
import type { Comment, Post } from '@zaa4eem/shared';
import { formatMemberNumber } from '@zaa4eem/shared';
import { api, ApiError } from '@/lib/api-client';
import { useAuth } from '@/lib/auth-context';
import { haptic } from '@/lib/telegram';
import { useApiData } from '@/lib/use-api-data';
import { Card } from '@/components/Card';
import { PremiumAvatar } from '@/components/PremiumAvatar';
import { PremiumName } from '@/components/PremiumName';
import { PresenceDot } from '@/components/PresenceDot';

/** Date + time, everywhere a post's timestamp renders (feed, profile). */
export function formatDate(iso: string) {
  return new Date(iso).toLocaleString('ru-RU', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
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
                <Link href={`/u/${comment.author.id}`} style={{ flexShrink: 0 }}>
                  <PremiumAvatar
                    name={comment.author.displayName}
                    avatarUrl={comment.author.avatarUrl}
                    size={26}
                    premium={comment.author}
                  />
                </Link>
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
                      <Link href={`/u/${comment.author.id}`}>
                        <PremiumName
                          name={comment.author.displayName}
                          premium={comment.author}
                          style={{ fontWeight: 700, fontSize: 'var(--z-fs-sm)', marginRight: 6 }}
                        />
                      </Link>
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

export function PostCard({
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
  const [sharing, setSharing] = useState(false);
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

  async function onShare() {
    setSharing(true);
    try {
      // Loaded on the click, not with the feed: the card renderer is a chunk
      // of canvas drawing code that every visitor was downloading as part of
      // the main bundle just in case someone pressed "Поделиться".
      const { sharePostCard } = await import('@/lib/share-card');
      await sharePostCard({
        authorName: post.author.displayName,
        body: post.body,
        likeCount: post.likeCount,
        commentCount: post.commentCount,
      });
    } finally {
      setSharing(false);
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
        <Link href={`/u/${post.author.id}`} style={{ flexShrink: 0, position: 'relative' }}>
          <PremiumAvatar
            name={post.author.displayName}
            avatarUrl={post.author.avatarUrl}
            ring={isOwner}
            premium={post.author}
          />
          <PresenceDot
            presence={post.author.presence}
            style={{ position: 'absolute', right: -1, bottom: -1 }}
          />
        </Link>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
            <Link href={`/u/${post.author.id}`}>
              <PremiumName name={post.author.displayName} premium={post.author} style={{ fontWeight: 700 }} />
            </Link>
            {isOwner && <span className="z-badge-owner">Владелец проекта</span>}
            <span style={{ fontSize: 'var(--z-fs-xs)', color: 'var(--z-text-faint)' }}>
              {formatMemberNumber(post.author.memberNumber)}
            </span>
            {user && !isOwnPost && (
              <button
                onClick={() => onToggleFollowAuthor(post.author.id, Boolean(post.author.viewerIsFollowing))}
                className="z-pop-on-active"
                title={post.author.viewerIsFollowing ? 'Отписаться' : 'Подписаться'}
                style={{
                  width: 20,
                  height: 20,
                  display: 'grid',
                  placeItems: 'center',
                  fontSize: 13,
                  lineHeight: 1,
                  fontWeight: 700,
                  padding: 0,
                  borderRadius: '50%',
                  border: `1px solid ${post.author.viewerIsFollowing ? 'var(--z-border)' : 'var(--z-accent)'}`,
                  background: post.author.viewerIsFollowing ? 'transparent' : 'var(--z-accent-soft)',
                  color: post.author.viewerIsFollowing ? 'var(--z-text-faint)' : 'var(--z-accent)',
                  cursor: 'pointer',
                }}
              >
                {post.author.viewerIsFollowing ? '✓' : '+'}
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
      {!editing && post.imageUrl && (
        // contain (not cover) inside a bounded box — post photos come in every
        // aspect ratio, and cropping someone's uploaded picture reads as broken.
        <div
          style={{
            marginTop: 12,
            maxHeight: 420,
            display: 'flex',
            justifyContent: 'center',
            background: 'var(--z-bg-elevated)',
            borderRadius: 'var(--z-radius-md)',
            overflow: 'hidden',
          }}
        >
          {/* Post images come in any aspect ratio, so the box reserves a
              minimum height rather than exact dimensions — enough to stop
              the card from collapsing and then jumping when the file lands. */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={post.imageUrl}
            alt="Изображение к посту"
            loading="lazy"
            decoding="async"
            style={{ maxWidth: '100%', maxHeight: 420, minHeight: 120, objectFit: 'contain' }}
          />
        </div>
      )}
      {!editing && post.moderationState === 'PENDING_REVIEW' && (
        <div style={{ marginTop: 10, fontSize: 'var(--z-fs-xs)', color: 'var(--z-warning)' }}>
          🕓 На проверке — пока видно только вам, скоро появится в общей ленте
        </div>
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
        <button onClick={onShare} disabled={sharing} className="z-btn-ghost z-pop-on-active">
          {sharing ? '…' : '📤 Поделиться'}
        </button>
      </div>
      {showComments && <CommentThread postId={post.id} />}
    </Card>
  );
}
