'use client';

import { useCallback, useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import type { PaginatedPosts, Post, PublicProfile } from '@zaa4eem/shared';
import { formatMemberNumber } from '@zaa4eem/shared';
import { api } from '@/lib/api-client';
import { useAuth } from '@/lib/auth-context';
import { haptic } from '@/lib/telegram';
import { Card } from '@/components/Card';
import { StatTile } from '@/components/StatTile';
import { Skeleton, SkeletonCircle, SkeletonText } from '@/components/Skeleton';
import { PremiumName } from '@/components/PremiumName';
import { getRingClass } from '@/components/PremiumAvatar';
import { PresenceDot } from '@/components/PresenceDot';
import { PostCard } from '@/components/PostCard';
import { shareProfileCard } from '@/lib/share-card';
import '@/styles/premium.css';

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL ?? (typeof window !== 'undefined' ? window.location.origin : '');

export default function PublicProfilePage() {
  const params = useParams<{ id: string }>();
  const { user: viewer } = useAuth();
  const [profile, setProfile] = useState<PublicProfile | null>(null);
  const [notFound, setNotFound] = useState(false);
  const [modActionMessage, setModActionMessage] = useState<string | null>(null);
  const [followBusy, setFollowBusy] = useState(false);
  const [sharing, setSharing] = useState(false);
  const [ideaCreditsOpen, setIdeaCreditsOpen] = useState(false);
  const [posts, setPosts] = useState<Post[] | null>(null);
  const [postsNextCursor, setPostsNextCursor] = useState<string | null>(null);
  const [postsError, setPostsError] = useState(false);
  const [loadingMorePosts, setLoadingMorePosts] = useState(false);

  async function onShareProfile() {
    if (!profile) return;
    setSharing(true);
    try {
      const bestScore = profile.stats.bestScoresByGame.length
        ? Math.max(...profile.stats.bestScoresByGame.map((s) => s.value))
        : null;
      await shareProfileCard(
        {
          displayName: profile.displayName,
          memberNumber: profile.memberNumber,
          ideasAcceptedCount: profile.stats.ideasAcceptedCount,
          gamesPlayedCount: profile.stats.gamesPlayedCount,
          bestScore,
        },
        `${SITE_URL}/u/${profile.id}`,
      );
    } finally {
      setSharing(false);
    }
  }

  async function moderateUser(action: 'mute' | 'ban') {
    const reason = window.prompt(`Причина (${action === 'mute' ? 'мут' : 'бан'}):`);
    if (!reason) return;
    try {
      await api.post(`/admin/users/${params.id}/${action}`, { reason });
      setModActionMessage(action === 'mute' ? 'Пользователь замьючен.' : 'Пользователь забанен.');
    } catch {
      setModActionMessage('Не удалось выполнить действие — попробуйте ещё раз.');
    }
  }

  async function toggleFollow() {
    if (!profile || followBusy) return;
    setFollowBusy(true);
    haptic('light');
    const wasFollowing = profile.viewerIsFollowing;
    setProfile({
      ...profile,
      viewerIsFollowing: !wasFollowing,
      followerCount: profile.followerCount + (wasFollowing ? -1 : 1),
    });
    try {
      if (wasFollowing) await api.delete(`/users/${profile.id}/follow`);
      else await api.post(`/users/${profile.id}/follow`);
    } catch {
      setProfile(profile);
    } finally {
      setFollowBusy(false);
    }
  }

  useEffect(() => {
    api
      .get<PublicProfile>(`/users/${params.id}`)
      .then(setProfile)
      .catch(() => setNotFound(true));
  }, [params.id]);

  const loadPosts = useCallback(async () => {
    setPostsError(false);
    try {
      const page = await api.get<PaginatedPosts>(`/posts?authorId=${params.id}`);
      setPosts(page.items);
      setPostsNextCursor(page.nextCursor);
    } catch {
      setPostsError(true);
    }
  }, [params.id]);

  useEffect(() => {
    loadPosts();
  }, [loadPosts]);

  async function loadMorePosts() {
    if (!postsNextCursor || loadingMorePosts) return;
    setLoadingMorePosts(true);
    try {
      const page = await api.get<PaginatedPosts>(`/posts?authorId=${params.id}&cursor=${postsNextCursor}`);
      setPosts([...(posts ?? []), ...page.items]);
      setPostsNextCursor(page.nextCursor);
    } catch {
      // Leave the loaded posts as-is — "Показать ещё" stays put to retry.
    } finally {
      setLoadingMorePosts(false);
    }
  }

  function replacePost(updated: Post) {
    setPosts((posts ?? []).map((p) => (p.id === updated.id ? updated : p)));
  }

  function removePostFromList(postId: string) {
    setPosts((posts ?? []).filter((p) => p.id !== postId));
  }

  async function toggleFollowAuthor(authorId: string, currentlyFollowing: boolean) {
    haptic('light');
    setPosts(
      (posts ?? []).map((p) =>
        p.author.id === authorId
          ? { ...p, author: { ...p.author, viewerIsFollowing: !currentlyFollowing } }
          : p,
      ),
    );
    try {
      if (currentlyFollowing) await api.delete(`/users/${authorId}/follow`);
      else await api.post(`/users/${authorId}/follow`);
    } catch {
      setPosts(
        (posts ?? []).map((p) =>
          p.author.id === authorId ? { ...p, author: { ...p.author, viewerIsFollowing: currentlyFollowing } } : p,
        ),
      );
    }
  }

  if (notFound) return <p style={{ color: 'var(--z-text-muted)' }}>Пользователь не найден.</p>;

  if (!profile) {
    return (
      <div style={{ maxWidth: 640, margin: '0 auto' }}>
        <Card style={{ padding: 0, overflow: 'hidden' }}>
          <Skeleton height={96} radius={0} />
          <div style={{ padding: 20, marginTop: -48 }}>
            <div style={{ display: 'flex', gap: 16, alignItems: 'flex-end' }}>
              <SkeletonCircle size={88} />
            </div>
            <div style={{ marginTop: 16, display: 'flex', flexDirection: 'column', gap: 8 }}>
              <SkeletonText width="45%" height={22} />
              <SkeletonText width="70%" />
              <SkeletonText width="30%" />
            </div>
          </div>
        </Card>
        <div style={{ display: 'flex', gap: 12, marginTop: 16 }}>
          {Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={i} width={120} height={72} radius="var(--z-radius-md)" />
          ))}
        </div>
      </div>
    );
  }

  const isOwner = profile.role === 'OWNER';

  return (
    <div style={{ maxWidth: 640, margin: '0 auto' }}>
      <Card className="z-animate-in" style={{ padding: 0, overflow: 'hidden' }}>
        <div
          style={{
            height: 96,
            background: profile.bannerUrl
              ? `center/cover url(${profile.bannerUrl})`
              : isOwner
                ? 'linear-gradient(120deg, var(--z-accent-strong), var(--z-accent) 60%, var(--z-accent-soft))'
                : 'linear-gradient(120deg, var(--z-surface-hover), var(--z-border))',
          }}
        />
        <div style={{ padding: 20, marginTop: -48 }}>
          <div style={{ display: 'flex', gap: 16, alignItems: 'flex-end', justifyContent: 'space-between' }}>
            <div style={{ display: 'flex', gap: 16, alignItems: 'flex-end' }}>
              {/* The ring effect's ::before extends outside the avatar's own box
                  (inset: -4px/-6px), so it needs its own wrapper — putting the
                  ring class directly on the avatar div would get clipped by
                  that div's own overflow: hidden (used to crop the photo). */}
              <span
                className={getRingClass(profile) || undefined}
                style={{ display: 'inline-flex', borderRadius: '50%', flexShrink: 0, position: 'relative' }}
              >
                <div
                  style={{
                    width: 88,
                    height: 88,
                    borderRadius: '50%',
                    background: 'var(--z-accent-soft)',
                    display: 'grid',
                    placeItems: 'center',
                    fontWeight: 800,
                    fontSize: 'var(--z-fs-xl)',
                    color: 'var(--z-accent)',
                    flexShrink: 0,
                    overflow: 'hidden',
                    border: '4px solid var(--z-surface)',
                    boxShadow: 'var(--z-shadow-card)',
                  }}
                >
                  {profile.avatarUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={profile.avatarUrl}
                      alt={profile.displayName}
                      style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                    />
                  ) : (
                    profile.displayName.charAt(0).toUpperCase()
                  )}
                </div>
                <PresenceDot presence={profile.presence} style={{ position: 'absolute', right: 2, bottom: 2 }} />
              </span>
              <div style={{ paddingBottom: 4 }}>
                <span className="z-badge" style={{ background: 'var(--z-bg-elevated)', color: 'var(--z-text-faint)' }}>
                  {formatMemberNumber(profile.memberNumber)}
                </span>
              </div>
            </div>
            {viewer?.id === profile.id ? (
              <Link href="/settings" className="z-btn-ghost z-pop-on-active" style={{ marginBottom: 4 }}>
                ⚙️ Редактировать профиль
              </Link>
            ) : (
              viewer && (
                <button
                  onClick={toggleFollow}
                  disabled={followBusy}
                  className={profile.viewerIsFollowing ? 'z-btn-ghost z-pop-on-active' : 'z-btn-accent z-pop-on-active'}
                  style={{ marginBottom: 4 }}
                >
                  {profile.viewerIsFollowing ? 'Отписаться' : '+ Подписаться'}
                </button>
              )
            )}
          </div>

          <div style={{ marginTop: 12 }}>
            <h1 style={{ margin: 0, display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
              <PremiumName name={profile.displayName} premium={profile} />
              {isOwner && <span className="z-badge-owner">Владелец проекта</span>}
              {profile.ideaCredits.length > 0 && (
                <button
                  className="z-badge-idea-credit z-pop-on-active"
                  onClick={() => setIdeaCreditsOpen((v) => !v)}
                >
                  💡 Автор идеи
                </button>
              )}
              {profile.ideaAuthorLevel !== null && (
                <span className="z-badge-idea-level" title="Уровень растёт с числом принятых идей">
                  ⭐ Ур. {profile.ideaAuthorLevel}
                </span>
              )}
              {profile.topGameBadges.map((badge) => (
                <span key={badge.gameSlug} className="z-badge-top1" title={`Топ-1 в игре «${badge.gameTitle}»`}>
                  🏆 Топ-1 {badge.gameTitle}
                </span>
              ))}
            </h1>
            {ideaCreditsOpen && profile.ideaCredits.length > 0 && (
              <div
                className="z-animate-fade"
                style={{
                  marginTop: 8,
                  background: 'var(--z-bg-elevated)',
                  border: '1px solid var(--z-border)',
                  borderRadius: 'var(--z-radius-sm)',
                  padding: '10px 12px',
                  fontSize: 'var(--z-fs-sm)',
                  color: 'var(--z-text-muted)',
                }}
              >
                {profile.ideaCredits.map((credit) => (
                  <div key={credit.id} style={{ marginBottom: 4 }}>
                    Предложил(а): <b style={{ color: 'var(--z-text)' }}>«{credit.description}»</b>
                  </div>
                ))}
                <Link href="/hall-of-fame" style={{ color: 'var(--z-accent)', fontSize: 'var(--z-fs-xs)' }}>
                  Зал славы →
                </Link>
              </div>
            )}
            {profile.statusText && (
              <p style={{ color: 'var(--z-accent)', fontSize: 'var(--z-fs-sm)', margin: '4px 0 0', fontStyle: 'italic' }}>
                {profile.statusText}
              </p>
            )}
            {profile.bio && <p style={{ color: 'var(--z-text-muted)', margin: '6px 0 0' }}>{profile.bio}</p>}
            <div style={{ display: 'flex', gap: 14, marginTop: 8, fontSize: 'var(--z-fs-sm)' }}>
              <Link href={`/u/${profile.id}/followers`}>
                <strong>{profile.followerCount}</strong>{' '}
                <span style={{ color: 'var(--z-text-muted)' }}>подписчиков</span>
              </Link>
              <Link href={`/u/${profile.id}/following`}>
                <strong>{profile.followingCount}</strong>{' '}
                <span style={{ color: 'var(--z-text-muted)' }}>подписок</span>
              </Link>
            </div>
            <p style={{ color: 'var(--z-text-faint)', fontSize: 'var(--z-fs-xs)', margin: '8px 0 0' }}>
              На платформе с {new Date(profile.createdAt).toLocaleDateString('ru-RU', { month: 'long', year: 'numeric' })}
            </p>
            <button
              onClick={onShareProfile}
              disabled={sharing}
              className="z-btn-ghost z-pop-on-active"
              style={{ marginTop: 10, fontSize: 'var(--z-fs-xs)', padding: '6px 12px' }}
            >
              {sharing ? '…' : '📤 Поделиться профилем'}
            </button>
          </div>

          {viewer?.role === 'OWNER' && viewer.id !== profile.id && (
            <div style={{ display: 'flex', gap: 8, marginTop: 16, borderTop: '1px solid var(--z-border)', paddingTop: 16 }}>
              <button className="z-btn-ghost z-pop-on-active" onClick={() => moderateUser('mute')}>
                Замьютить
              </button>
              <button className="z-btn-danger z-pop-on-active" onClick={() => moderateUser('ban')}>
                Забанить
              </button>
              {modActionMessage && (
                <span style={{ fontSize: 'var(--z-fs-sm)', color: 'var(--z-accent)', alignSelf: 'center' }}>
                  {modActionMessage}
                </span>
              )}
            </div>
          )}
        </div>
      </Card>

      <div
        className="z-animate-in"
        style={{ display: 'flex', gap: 12, marginTop: 16, flexWrap: 'wrap', animationDelay: '80ms' }}
      >
        <StatTile label="Идей предложено" value={profile.stats.ideasSubmittedCount} />
        <StatTile label="Идей принято" value={profile.stats.ideasAcceptedCount} />
        <StatTile label="Игр сыграно" value={profile.stats.gamesPlayedCount} />
      </div>

      {profile.stats.bestScoresByGame.length > 0 && (
        <div className="z-animate-in" style={{ marginTop: 16, animationDelay: '140ms' }}>
          <Card hover>
            <h3 style={{ marginTop: 0 }}>Лучшие результаты</h3>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {profile.stats.bestScoresByGame.map((s) => (
                <div key={s.gameSlug} style={{ display: 'flex', justifyContent: 'space-between' }}>
                  <span style={{ color: 'var(--z-text-muted)' }}>{s.gameTitle}</span>
                  <span style={{ fontWeight: 700, color: 'var(--z-accent)' }}>{s.value}</span>
                </div>
              ))}
            </div>
          </Card>
        </div>
      )}

      <div className="z-animate-in" style={{ marginTop: 24, animationDelay: '180ms' }}>
        <h3 style={{ marginBottom: 12 }}>Посты</h3>
        {postsError ? (
          <p style={{ color: 'var(--z-danger)', fontSize: 'var(--z-fs-sm)' }}>Не удалось загрузить посты.</p>
        ) : posts === null ? (
          <p style={{ color: 'var(--z-text-muted)', fontSize: 'var(--z-fs-sm)' }}>Загрузка…</p>
        ) : posts.length === 0 ? (
          <p style={{ color: 'var(--z-text-faint)', fontSize: 'var(--z-fs-sm)' }}>Постов пока нет.</p>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            {posts.map((post, i) => (
              <PostCard
                key={post.id}
                post={post}
                onChange={replacePost}
                onDelete={removePostFromList}
                onToggleFollowAuthor={toggleFollowAuthor}
                index={i}
              />
            ))}
            {postsNextCursor && (
              <button
                onClick={loadMorePosts}
                disabled={loadingMorePosts}
                className="z-btn-ghost z-pop-on-active"
                style={{ alignSelf: 'center', opacity: loadingMorePosts ? 0.6 : 1 }}
              >
                {loadingMorePosts ? 'Загрузка…' : 'Показать ещё'}
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
