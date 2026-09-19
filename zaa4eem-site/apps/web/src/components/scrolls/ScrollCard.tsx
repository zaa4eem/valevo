'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import type { Scroll, ScrollComment } from '@zaa4eem/shared';
import { api, getApiBase } from '@/lib/api-client';
import { useAuth } from '@/lib/auth-context';
import { haptic } from '@/lib/telegram';
import { PremiumAvatar } from '@/components/PremiumAvatar';
import { PremiumName } from '@/components/PremiumName';
import { Avatar } from '@/components/Avatar';

/** Uploads are served by the API, not by Next — the paths the API returns are relative to it. */
function mediaUrl(url: string) {
  if (!url || /^https?:\/\//.test(url)) return url;
  return `${getApiBase().replace(/\/api$/, '')}${url}`;
}

export function ScrollCard({
  scroll,
  active,
  onChange,
}: {
  scroll: Scroll;
  active: boolean;
  onChange: (scroll: Scroll) => void;
}) {
  const { user } = useAuth();
  const videoRef = useRef<HTMLVideoElement>(null);
  const [muted, setMuted] = useState(true);
  const [paused, setPaused] = useState(false);
  const [commentsOpen, setCommentsOpen] = useState(false);
  const countedView = useRef(false);

  /**
   * Only the clip in view plays.
   *
   * Muted is not a preference here, it is what makes autoplay legal: every
   * mobile browser blocks an unmuted autoplay outright, so a feed that
   * started with sound would simply show a wall of frozen first frames.
   * Tapping the speaker is the gesture that buys the sound.
   */
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    if (active && !paused) {
      // A rejected play() is normal (the tab is hidden, the gesture policy
      // said no) and must not become an unhandled rejection.
      video.play().catch(() => undefined);
      if (!countedView.current) {
        countedView.current = true;
        api.post(`/scrolls/${scroll.id}/view`).catch(() => undefined);
      }
    } else {
      video.pause();
      if (!active) video.currentTime = 0;
    }
  }, [active, paused, scroll.id]);

  async function toggleLike() {
    if (!user) return;
    haptic('light');
    const wasLiked = scroll.viewerHasLiked;
    // Optimistic, then replaced by whatever the server says.
    onChange({
      ...scroll,
      viewerHasLiked: !wasLiked,
      likeCount: scroll.likeCount + (wasLiked ? -1 : 1),
    });
    try {
      const updated = wasLiked
        ? await api.delete<Scroll>(`/scrolls/${scroll.id}/like`)
        : await api.post<Scroll>(`/scrolls/${scroll.id}/like`);
      onChange(updated);
    } catch {
      onChange(scroll);
    }
  }

  return (
    <div
      style={{
        position: 'relative',
        height: '100%',
        scrollSnapAlign: 'start',
        scrollSnapStop: 'always',
        background: '#000',
        borderRadius: 'var(--z-radius-md)',
        overflow: 'hidden',
      }}
    >
      <video
        ref={videoRef}
        src={mediaUrl(scroll.videoUrl)}
        poster={mediaUrl(scroll.posterUrl)}
        muted={muted}
        loop
        playsInline
        preload={active ? 'auto' : 'metadata'}
        onClick={() => setPaused((p) => !p)}
        style={{ width: '100%', height: '100%', objectFit: 'contain', display: 'block', cursor: 'pointer' }}
      />

      {paused && active && (
        <div
          onClick={() => setPaused(false)}
          style={{
            position: 'absolute',
            inset: 0,
            display: 'grid',
            placeItems: 'center',
            fontSize: 52,
            color: 'rgba(255,255,255,0.85)',
            cursor: 'pointer',
          }}
        >
          ▶
        </div>
      )}

      {/* Action rail */}
      <div
        style={{
          position: 'absolute',
          right: 10,
          bottom: 92,
          display: 'flex',
          flexDirection: 'column',
          gap: 14,
          alignItems: 'center',
        }}
      >
        <RailButton
          label={String(scroll.likeCount)}
          onClick={toggleLike}
          active={scroll.viewerHasLiked}
          title={user ? 'Нравится' : 'Войдите, чтобы лайкать'}
        >
          {scroll.viewerHasLiked ? '❤️' : '🤍'}
        </RailButton>
        <RailButton label={String(scroll.commentCount)} onClick={() => setCommentsOpen(true)} title="Комментарии">
          💬
        </RailButton>
        <RailButton label={muted ? 'Звук' : 'Тихо'} onClick={() => setMuted((m) => !m)} title="Звук">
          {muted ? '🔇' : '🔊'}
        </RailButton>
      </div>

      {/* Author + caption */}
      <div
        style={{
          position: 'absolute',
          left: 0,
          right: 70,
          bottom: 0,
          padding: '40px 14px 14px',
          // The gradient is what keeps white text readable over a clip that
          // happens to be white at the bottom.
          background: 'linear-gradient(to top, rgba(0,0,0,0.75), transparent)',
          color: '#fff',
        }}
      >
        <Link
          href={`/u/${scroll.author.id}`}
          style={{ display: 'flex', alignItems: 'center', gap: 8, color: '#fff' }}
        >
          <PremiumAvatar
            name={scroll.author.displayName}
            avatarUrl={scroll.author.avatarUrl}
            size={30}
            premium={scroll.author}
          />
          <span style={{ fontWeight: 800 }}>
            <PremiumName name={scroll.author.displayName} premium={scroll.author} />
          </span>
        </Link>
        {scroll.caption && (
          <p style={{ margin: '8px 0 0', fontSize: 'var(--z-fs-sm)', lineHeight: 1.35 }}>{scroll.caption}</p>
        )}
        <div style={{ marginTop: 6, fontSize: 'var(--z-fs-xs)', opacity: 0.75 }}>
          {scroll.viewCount} просмотров
        </div>
      </div>

      {commentsOpen && (
        <CommentsSheet
          scroll={scroll}
          onClose={() => setCommentsOpen(false)}
          onCountChange={(count) => onChange({ ...scroll, commentCount: count })}
        />
      )}
    </div>
  );
}

function RailButton({
  children,
  label,
  onClick,
  active,
  title,
}: {
  children: React.ReactNode;
  label: string;
  onClick: () => void;
  active?: boolean;
  title: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      className="z-pop-on-active"
      style={{
        background: 'rgba(0,0,0,0.42)',
        border: 'none',
        borderRadius: 999,
        width: 44,
        padding: '8px 0',
        color: active ? 'var(--z-accent)' : '#fff',
        cursor: 'pointer',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        gap: 2,
        fontSize: 20,
        lineHeight: 1,
      }}
    >
      <span aria-hidden>{children}</span>
      <span style={{ fontSize: 11, fontWeight: 700 }}>{label}</span>
    </button>
  );
}

function CommentsSheet({
  scroll,
  onClose,
  onCountChange,
}: {
  scroll: Scroll;
  onClose: () => void;
  onCountChange: (count: number) => void;
}) {
  const { user } = useAuth();
  const [comments, setComments] = useState<ScrollComment[] | null>(null);
  const [body, setBody] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api
      .get<ScrollComment[]>(`/scrolls/${scroll.id}/comments`)
      .then(setComments)
      .catch(() => setComments([]));
  }, [scroll.id]);

  async function send(e: React.FormEvent) {
    e.preventDefault();
    if (!body.trim() || busy) return;
    setBusy(true);
    try {
      const next = await api.post<ScrollComment[]>(`/scrolls/${scroll.id}/comments`, { body: body.trim() });
      setComments(next);
      onCountChange(next.length);
      setBody('');
    } catch {
      // Leave the text in the box so it isn't lost.
    } finally {
      setBusy(false);
    }
  }

  return (
    <div
      style={{
        position: 'absolute',
        inset: 0,
        background: 'rgba(0,0,0,0.55)',
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'flex-end',
      }}
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="z-animate-in"
        style={{
          background: 'var(--z-surface)',
          borderTopLeftRadius: 'var(--z-radius-md)',
          borderTopRightRadius: 'var(--z-radius-md)',
          maxHeight: '70%',
          display: 'flex',
          flexDirection: 'column',
        }}
      >
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            padding: '12px 14px',
            borderBottom: '1px solid var(--z-border)',
          }}
        >
          <strong>Комментарии</strong>
          <button
            type="button"
            onClick={onClose}
            className="z-btn-ghost z-pop-on-active"
            style={{ marginLeft: 'auto', fontSize: 'var(--z-fs-xs)', padding: '4px 10px' }}
          >
            Закрыть
          </button>
        </div>

        <div style={{ overflowY: 'auto', padding: 14, display: 'flex', flexDirection: 'column', gap: 12 }}>
          {comments === null ? (
            <p style={{ color: 'var(--z-text-faint)', fontSize: 'var(--z-fs-sm)', margin: 0 }}>Загрузка…</p>
          ) : comments.length === 0 ? (
            <p style={{ color: 'var(--z-text-faint)', fontSize: 'var(--z-fs-sm)', margin: 0 }}>
              Пока тихо — скажи первым.
            </p>
          ) : (
            comments.map((comment) => (
              <div key={comment.id} style={{ display: 'flex', gap: 10 }}>
                <Avatar name={comment.author.displayName} avatarUrl={comment.author.avatarUrl} size={28} />
                <div style={{ minWidth: 0 }}>
                  <Link href={`/u/${comment.author.id}`} style={{ fontWeight: 700, fontSize: 'var(--z-fs-sm)' }}>
                    <PremiumName name={comment.author.displayName} premium={comment.author} />
                  </Link>
                  <p style={{ margin: '2px 0 0', fontSize: 'var(--z-fs-sm)', color: 'var(--z-text-muted)' }}>
                    {comment.body}
                  </p>
                </div>
              </div>
            ))
          )}
        </div>

        {user ? (
          <form
            onSubmit={send}
            style={{ display: 'flex', gap: 8, padding: 12, borderTop: '1px solid var(--z-border)' }}
          >
            <input
              className="z-input"
              value={body}
              onChange={(e) => setBody(e.target.value)}
              placeholder="Написать…"
              maxLength={500}
              style={{ flex: 1 }}
            />
            <button type="submit" disabled={busy || !body.trim()} className="z-btn-accent z-pop-on-active">
              {busy ? '…' : 'Ок'}
            </button>
          </form>
        ) : (
          <div style={{ padding: 12, borderTop: '1px solid var(--z-border)', textAlign: 'center' }}>
            <Link href="/login" className="z-btn-ghost z-pop-on-active">
              Войти, чтобы комментировать
            </Link>
          </div>
        )}
      </div>
    </div>
  );
}
