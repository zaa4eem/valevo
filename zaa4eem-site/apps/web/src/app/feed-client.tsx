'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { PaginatedPosts, Post } from '@zaa4eem/shared';

import { api, ApiError } from '@/lib/api-client';
import { useAuth } from '@/lib/auth-context';
import { haptic, hapticNotify } from '@/lib/telegram';
import { Card } from '@/components/Card';
import { OnboardingCard } from '@/components/OnboardingCard';
import { PremiumAvatar } from '@/components/PremiumAvatar';
import { PostCard } from '@/components/PostCard';

function Composer({ onPosted }: { onPosted: (post: Post) => void }) {
  const { user } = useAuth();
  const [body, setBody] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [focused, setFocused] = useState(false);
  const [imageFile, setImageFile] = useState<File | null>(null);
  const [imagePreview, setImagePreview] = useState<string | null>(null);
  const imageInputRef = useRef<HTMLInputElement>(null);

  function pickImage(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setError(null);
    if (imagePreview) URL.revokeObjectURL(imagePreview);
    setImageFile(file);
    setImagePreview(URL.createObjectURL(file));
  }

  function clearImage() {
    if (imagePreview) URL.revokeObjectURL(imagePreview);
    setImageFile(null);
    setImagePreview(null);
    if (imageInputRef.current) imageInputRef.current.value = '';
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!body.trim()) return;
    setBusy(true);
    setError(null);
    try {
      let imageUrl: string | undefined;
      if (imageFile) {
        const form = new FormData();
        form.append('image', imageFile);
        const uploaded = await api.upload<{ imageUrl: string }>('/posts/me/image', form);
        imageUrl = uploaded.imageUrl;
      }
      const post = await api.post<Post>('/posts', { body: body.trim(), publish: true, imageUrl });
      setBody('');
      clearImage();
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
        <PremiumAvatar name={user.displayName} avatarUrl={user.avatarUrl} ring premium={user} />
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
          {imagePreview && (
            <div style={{ position: 'relative', display: 'inline-block', alignSelf: 'flex-start' }}>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={imagePreview}
                alt="Предпросмотр изображения"
                style={{
                  maxHeight: 180,
                  maxWidth: '100%',
                  borderRadius: 'var(--z-radius-md)',
                  border: '1px solid var(--z-border)',
                  display: 'block',
                }}
              />
              <button
                type="button"
                onClick={clearImage}
                title="Убрать изображение"
                className="z-pop-on-active"
                style={{
                  position: 'absolute',
                  top: -8,
                  right: -8,
                  width: 24,
                  height: 24,
                  borderRadius: '50%',
                  border: '1px solid var(--z-border)',
                  background: 'var(--z-surface)',
                  color: 'var(--z-text)',
                  cursor: 'pointer',
                  display: 'grid',
                  placeItems: 'center',
                  fontSize: 12,
                  lineHeight: 1,
                }}
              >
                ✕
              </button>
            </div>
          )}
          {error && <div style={{ color: 'var(--z-danger)', fontSize: 'var(--z-fs-sm)' }}>{error}</div>}
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <input
                ref={imageInputRef}
                type="file"
                accept="image/jpeg,image/png,image/webp,image/gif"
                onChange={pickImage}
                disabled={busy}
                style={{ display: 'none' }}
                id="post-image-input"
              />
              <label
                htmlFor="post-image-input"
                className="z-btn-ghost z-pop-on-active"
                title="Прикрепить изображение"
                style={{ cursor: 'pointer', padding: '4px 10px', fontSize: 'var(--z-fs-sm)' }}
              >
                📷
              </label>
              <span style={{ fontSize: 'var(--z-fs-xs)', color: 'var(--z-text-faint)' }}>
                {user.role === 'OWNER' ? 'Без ограничений' : 'Раз в 12 часов'}
              </span>
            </div>
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


const SORT_OPTIONS: { value: 'date' | 'popularity'; label: string }[] = [
  { value: 'date', label: 'Новые' },
  { value: 'popularity', label: 'Популярные' },
];

export default function HomeFeedClient({ initialPage }: { initialPage: PaginatedPosts | null }) {
  const { user } = useAuth();
  const [list, setList] = useState<Post[] | null>(initialPage?.items ?? null);
  const [nextCursor, setNextCursor] = useState<string | null>(initialPage?.nextCursor ?? null);
  const [error, setError] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [sort, setSort] = useState<'date' | 'popularity'>('date');
  // The server-rendered page is the same for everybody, so it can't know
  // which posts *this* viewer liked or whose authors they follow. One
  // refresh once we know who's watching fills that in; guests keep the
  // server's copy and make no request at all.
  const hydratedForViewer = useRef(false);

  const loadFirstPage = useCallback(async (activeSort: 'date' | 'popularity', keepVisible = false) => {
    setError(false);
    if (!keepVisible) setList(null);
    try {
      const page = await api.get<PaginatedPosts>(`/posts?sort=${activeSort}`);
      setList(page.items);
      setNextCursor(page.nextCursor);
    } catch {
      if (!keepVisible) setError(true);
    }
  }, []);

  useEffect(() => {
    // Nothing to fetch on first paint when the server already handed us the
    // list — that's the whole point of rendering it there.
    if (initialPage && sort === 'date' && !hydratedForViewer.current) return;
    loadFirstPage(sort);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loadFirstPage, sort]);

  useEffect(() => {
    if (!user || hydratedForViewer.current) return;
    hydratedForViewer.current = true;
    // keepVisible: swap the data in underneath instead of blanking the feed
    // the viewer is already reading.
    loadFirstPage(sort, true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user]);

  async function loadMore() {
    if (!nextCursor || loadingMore) return;
    setLoadingMore(true);
    try {
      const page = await api.get<PaginatedPosts>(`/posts?cursor=${nextCursor}&sort=${sort}`);
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

      {/* Above the composer on purpose: a brand-new account's first question
          is "what do I do here", and the checklist answers it before the
          empty text box can ask it back. Hides itself for good once the
          reward is taken. */}
      <OnboardingCard />

      <div style={{ marginBottom: 16 }}>
        <Composer onPosted={prependPost} />
      </div>

      <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
        {SORT_OPTIONS.map((option) => (
          <button
            key={option.value}
            onClick={() => setSort(option.value)}
            className={sort === option.value ? 'z-btn-accent z-pop-on-active' : 'z-btn-ghost z-pop-on-active'}
            style={{ fontSize: 'var(--z-fs-sm)', padding: '6px 14px' }}
          >
            {option.label}
          </button>
        ))}
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
