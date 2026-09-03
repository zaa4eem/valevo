'use client';

import { useEffect, useState } from 'react';
import type { CSSProperties } from 'react';
import Link from 'next/link';
import type { SearchResults } from '@zaa4eem/shared';
import { formatMemberNumber } from '@zaa4eem/shared';
import { api } from '@/lib/api-client';
import { Card } from '@/components/Card';
import { Avatar } from '@/components/Avatar';
import { EmptyState } from '@/components/EmptyState';
import { SkeletonCard } from '@/components/Skeleton';

const IDEA_STATUS_LABELS: Record<string, string> = {
  NEW: 'Новая',
  UNDER_REVIEW: 'На рассмотрении',
  ACCEPTED: 'Принята',
  IN_PROGRESS: 'В разработке',
  SHIPPED: 'Готово',
  DECLINED: 'Отклонена',
};

const sectionTitleStyle: CSSProperties = {
  fontSize: 'var(--z-fs-sm)',
  textTransform: 'uppercase',
  letterSpacing: '0.06em',
  color: 'var(--z-text-faint)',
  margin: '0 0 10px',
};

export default function SearchPage() {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<SearchResults | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(false);

  useEffect(() => {
    const trimmed = query.trim();
    if (trimmed.length < 2) {
      setResults(null);
      setError(false);
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(false);
    const timeout = setTimeout(() => {
      api
        .get<SearchResults>(`/search?q=${encodeURIComponent(trimmed)}`)
        .then(setResults)
        .catch(() => setError(true))
        .finally(() => setLoading(false));
    }, 300);
    return () => clearTimeout(timeout);
  }, [query]);

  const trimmedQuery = query.trim();
  const totalCount = results ? results.users.length + results.posts.length + results.ideas.length : 0;

  return (
    <div style={{ maxWidth: 640, margin: '0 auto' }}>
      <h1 style={{ fontSize: 'var(--z-fs-2xl)', marginTop: 0 }}>Поиск</h1>
      <input
        className="z-input"
        placeholder="Профили, посты, идеи…"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        autoFocus
        style={{ marginBottom: 20, width: '100%' }}
      />

      {trimmedQuery.length > 0 && trimmedQuery.length < 2 && (
        <p style={{ color: 'var(--z-text-faint)', fontSize: 'var(--z-fs-sm)' }}>Введите ещё хотя бы один символ.</p>
      )}
      {error && <p style={{ color: 'var(--z-danger)' }}>Не удалось выполнить поиск. Попробуйте ещё раз.</p>}
      {loading && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {Array.from({ length: 3 }).map((_, i) => (
            <SkeletonCard key={i} lines={1} avatar />
          ))}
        </div>
      )}

      {results &&
        !loading &&
        (totalCount === 0 ? (
          <EmptyState icon="🔍" description={`Ничего не найдено по запросу «${trimmedQuery}».`} />
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
            {results.users.length > 0 && (
              <section>
                <h2 style={sectionTitleStyle}>Профили</h2>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  {results.users.map((u, i) => (
                    <Link key={u.id} href={`/u/${u.id}`}>
                      <Card
                        hover
                        className="z-animate-in"
                        style={{ display: 'flex', alignItems: 'center', gap: 12, animationDelay: `${Math.min(i, 8) * 40}ms` }}
                      >
                        <Avatar name={u.displayName} avatarUrl={u.avatarUrl} size={36} />
                        <div style={{ flex: 1, display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
                          <span style={{ fontWeight: 700 }}>{u.displayName}</span>
                          {u.role === 'OWNER' && <span className="z-badge">Owner</span>}
                          <span style={{ fontSize: 'var(--z-fs-xs)', color: 'var(--z-text-faint)' }}>
                            {formatMemberNumber(u.memberNumber)}
                          </span>
                        </div>
                      </Card>
                    </Link>
                  ))}
                </div>
              </section>
            )}

            {results.posts.length > 0 && (
              <section>
                <h2 style={sectionTitleStyle}>Посты</h2>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  {results.posts.map((p, i) => (
                    <Link key={p.id} href={`/u/${p.author.id}`}>
                      <Card hover className="z-animate-in" style={{ animationDelay: `${Math.min(i, 8) * 40}ms` }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
                          <Avatar name={p.author.displayName} avatarUrl={p.author.avatarUrl} size={24} />
                          <span style={{ fontSize: 'var(--z-fs-sm)', fontWeight: 700 }}>{p.author.displayName}</span>
                        </div>
                        <p style={{ margin: 0, color: 'var(--z-text-muted)', fontSize: 'var(--z-fs-sm)' }}>
                          {p.body.length > 160 ? `${p.body.slice(0, 160)}…` : p.body}
                        </p>
                      </Card>
                    </Link>
                  ))}
                </div>
              </section>
            )}

            {results.ideas.length > 0 && (
              <section>
                <h2 style={sectionTitleStyle}>Идеи</h2>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  {results.ideas.map((i, idx) => (
                    <Link key={i.id} href={`/ideas/${i.id}`}>
                      <Card hover className="z-animate-in" style={{ animationDelay: `${Math.min(idx, 8) * 40}ms` }}>
                        <span className="z-badge">{IDEA_STATUS_LABELS[i.status] ?? i.status}</span>
                        <div style={{ fontWeight: 700, marginTop: 6 }}>{i.title}</div>
                        <p style={{ margin: '4px 0 0', color: 'var(--z-text-muted)', fontSize: 'var(--z-fs-sm)' }}>
                          {i.description.length > 140 ? `${i.description.slice(0, 140)}…` : i.description}
                        </p>
                      </Card>
                    </Link>
                  ))}
                </div>
              </section>
            )}
          </div>
        ))}
    </div>
  );
}
