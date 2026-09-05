'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import type { PaginatedUserSummaries } from '@zaa4eem/shared';
import { formatMemberNumber } from '@zaa4eem/shared';
import { api } from '@/lib/api-client';
import { Card } from './Card';
import { PremiumAvatar } from './PremiumAvatar';
import { PremiumName } from './PremiumName';
import { EmptyState } from './EmptyState';

export function FollowList({
  userId,
  kind,
  title,
  emptyText,
}: {
  userId: string;
  kind: 'followers' | 'following';
  title: string;
  emptyText: string;
}) {
  const [users, setUsers] = useState<PaginatedUserSummaries['items']>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(false);
    try {
      const page = await api.get<PaginatedUserSummaries>(`/users/${userId}/${kind}`);
      setUsers(page.items);
      setNextCursor(page.nextCursor);
    } catch {
      setError(true);
    } finally {
      setLoading(false);
    }
  }, [userId, kind]);

  useEffect(() => {
    load();
  }, [load]);

  async function loadMore() {
    if (!nextCursor || loadingMore) return;
    setLoadingMore(true);
    try {
      const page = await api.get<PaginatedUserSummaries>(`/users/${userId}/${kind}?cursor=${nextCursor}`);
      setUsers((prev) => [...prev, ...page.items]);
      setNextCursor(page.nextCursor);
    } finally {
      setLoadingMore(false);
    }
  }

  return (
    <div style={{ maxWidth: 480, margin: '0 auto' }}>
      <h1 style={{ fontSize: 'var(--z-fs-2xl)', marginTop: 0 }}>{title}</h1>

      {error ? (
        <p style={{ color: 'var(--z-danger)' }}>Не удалось загрузить список.</p>
      ) : loading ? (
        <p style={{ color: 'var(--z-text-muted)' }}>Загрузка…</p>
      ) : users.length === 0 ? (
        <EmptyState icon="👥" description={emptyText} />
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {users.map((u, i) => (
            <Link key={u.id} href={`/u/${u.id}`}>
              <Card
                hover
                className="z-animate-in"
                style={{ display: 'flex', alignItems: 'center', gap: 12, animationDelay: `${Math.min(i, 8) * 40}ms` }}
              >
                <PremiumAvatar name={u.displayName} avatarUrl={u.avatarUrl} size={40} premium={u} />
                <div style={{ flex: 1, display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
                  <PremiumName name={u.displayName} premium={u} style={{ fontWeight: 700 }} />
                  {u.role === 'OWNER' && <span className="z-badge-owner">Владелец проекта</span>}
                  <span style={{ fontSize: 'var(--z-fs-xs)', color: 'var(--z-text-faint)' }}>
                    {formatMemberNumber(u.memberNumber)}
                  </span>
                </div>
              </Card>
            </Link>
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
