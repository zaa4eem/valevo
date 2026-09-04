'use client';

import Link from 'next/link';
import { useState } from 'react';
import type { Idea } from '@zaa4eem/shared';
import { api, ApiError } from '@/lib/api-client';
import { useAuth } from '@/lib/auth-context';
import { haptic } from '@/lib/telegram';
import { Avatar } from './Avatar';
import { Card } from './Card';

const STATUS_LABELS: Record<string, string> = {
  NEW: 'Новая',
  UNDER_REVIEW: 'На рассмотрении',
  ACCEPTED: 'Принята',
  IN_PROGRESS: 'В разработке',
  SHIPPED: 'Готово',
  DECLINED: 'Отклонена',
};

// A sequential accent ramp for status, the same color-mix technique the
// admin dashboard's charts use — brighter accent the further along an idea
// is, rather than an arbitrary hardcoded color per status.
const STATUS_TINTS: Record<string, string> = {
  NEW: 'color-mix(in oklab, var(--z-accent) 20%, var(--z-surface))',
  UNDER_REVIEW: 'color-mix(in oklab, var(--z-accent) 35%, var(--z-surface))',
  ACCEPTED: 'color-mix(in oklab, var(--z-accent) 55%, var(--z-surface))',
  IN_PROGRESS: 'color-mix(in oklab, var(--z-accent) 75%, var(--z-surface))',
  SHIPPED: 'color-mix(in oklab, var(--z-accent) 90%, var(--z-surface))',
  DECLINED: 'var(--z-surface-hover)',
};
// Lighter tints keep the accent as text color for contrast; the more
// saturated tints (IN_PROGRESS/SHIPPED) switch to the on-accent color.
const STATUS_TEXT: Record<string, string> = {
  NEW: 'var(--z-accent)',
  UNDER_REVIEW: 'var(--z-accent)',
  ACCEPTED: 'var(--z-accent)',
  IN_PROGRESS: 'var(--z-accent-text-on)',
  SHIPPED: 'var(--z-accent-text-on)',
  DECLINED: 'var(--z-text-faint)',
};

export function IdeaCard({
  idea,
  onVoteChange,
  index = 0,
}: {
  idea: Idea;
  onVoteChange?: () => void;
  index?: number;
}) {
  const { user } = useAuth();
  const [voteCount, setVoteCount] = useState(idea.voteCount);
  const [hasVoted, setHasVoted] = useState(Boolean(idea.viewerHasVoted));
  const [pending, setPending] = useState(false);

  async function toggleVote() {
    if (!user || pending) return;
    setPending(true);
    haptic('light');
    try {
      if (hasVoted) {
        await api.delete(`/ideas/${idea.id}/vote`);
        setHasVoted(false);
        setVoteCount((v) => v - 1);
      } else {
        await api.post(`/ideas/${idea.id}/vote`);
        setHasVoted(true);
        setVoteCount((v) => v + 1);
      }
      onVoteChange?.();
    } catch (err) {
      if (err instanceof ApiError && err.statusCode === 409) {
        setHasVoted(true);
      }
    } finally {
      setPending(false);
    }
  }

  return (
    <Card
      hover
      className="z-animate-in"
      style={{
        animationDelay: `${Math.min(index, 8) * 45}ms`,
        borderLeft: `3px solid ${STATUS_TINTS[idea.status] ?? 'transparent'}`,
      }}
    >
      <div style={{ display: 'flex', gap: 16 }}>
        <button
          onClick={toggleVote}
          disabled={!user || pending}
          title={user ? 'Голосовать' : 'Войдите, чтобы голосовать'}
          className="z-pop-on-active"
          style={{
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            width: 56,
            height: 56,
            flexShrink: 0,
            borderRadius: 'var(--z-radius-md)',
            border: `1px solid ${hasVoted ? 'var(--z-accent)' : 'var(--z-border)'}`,
            background: hasVoted ? 'var(--z-accent-soft)' : 'transparent',
            color: hasVoted ? 'var(--z-accent)' : 'var(--z-text-muted)',
            cursor: user ? 'pointer' : 'not-allowed',
            fontWeight: 800,
            transition: 'transform .25s cubic-bezier(0.34, 1.56, 0.64, 1), color .2s ease, border-color .2s ease',
          }}
        >
          <span style={{ fontSize: 'var(--z-fs-lg)', lineHeight: 1 }}>▲</span>
          <span>{voteCount}</span>
        </button>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 6, flexWrap: 'wrap' }}>
            <span
              className="z-badge"
              style={{
                background: STATUS_TINTS[idea.status] ?? 'var(--z-accent-soft)',
                color: STATUS_TEXT[idea.status] ?? 'var(--z-accent)',
              }}
            >
              {STATUS_LABELS[idea.status] ?? idea.status}
            </span>
            {idea.moderationState === 'PENDING_REVIEW' && (
              <span className="z-badge" style={{ background: 'rgba(251,191,36,0.15)', color: 'var(--z-warning)' }}>
                На проверке
              </span>
            )}
          </div>
          <Link href={`/ideas/${idea.id}`} style={{ fontSize: 'var(--z-fs-lg)', fontWeight: 700 }}>
            {idea.title}
          </Link>
          <p style={{ color: 'var(--z-text-muted)', fontSize: 'var(--z-fs-sm)', marginTop: 6 }}>
            {idea.description.length > 160 ? `${idea.description.slice(0, 160)}…` : idea.description}
          </p>
          <Link
            href={`/u/${idea.submitter.id}`}
            style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 'var(--z-fs-xs)', color: 'var(--z-text-faint)', marginTop: 8 }}
          >
            <Avatar name={idea.submitter.displayName} avatarUrl={idea.submitter.avatarUrl} size={18} />
            от {idea.submitter.displayName}
          </Link>
        </div>
      </div>
    </Card>
  );
}
