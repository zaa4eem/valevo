'use client';

import Link from 'next/link';
import { useState } from 'react';
import type { Idea } from '@zaa4eem/shared';
import { api, ApiError } from '@/lib/api-client';
import { useAuth } from '@/lib/auth-context';
import { haptic } from '@/lib/telegram';
import { Card } from './Card';

const STATUS_LABELS: Record<string, string> = {
  NEW: 'Новая',
  UNDER_REVIEW: 'На рассмотрении',
  ACCEPTED: 'Принята',
  IN_PROGRESS: 'В разработке',
  SHIPPED: 'Готово',
  DECLINED: 'Отклонена',
};

export function IdeaCard({ idea, onVoteChange }: { idea: Idea; onVoteChange?: () => void }) {
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
    <Card>
      <div style={{ display: 'flex', gap: 16 }}>
        <button
          onClick={toggleVote}
          disabled={!user || pending}
          title={user ? 'Голосовать' : 'Войдите, чтобы голосовать'}
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
          }}
        >
          <span>▲</span>
          <span>{voteCount}</span>
        </button>
        <div style={{ flex: 1 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 6 }}>
            <span className="z-badge">{STATUS_LABELS[idea.status] ?? idea.status}</span>
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
          <div style={{ fontSize: 'var(--z-fs-xs)', color: 'var(--z-text-faint)', marginTop: 8 }}>
            от {idea.submitter.displayName}
          </div>
        </div>
      </div>
    </Card>
  );
}
