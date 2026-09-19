'use client';

import { useEffect, useState } from 'react';
import type { CSSProperties } from 'react';
import Link from 'next/link';
import type { Discover, SearchResults } from '@zaa4eem/shared';
import { formatMemberNumber, plural, searchTypeValues, type SearchQuery } from '@zaa4eem/shared';
import { api } from '@/lib/api-client';
import { Card } from '@/components/Card';
import { Avatar } from '@/components/Avatar';
import { EmptyState } from '@/components/EmptyState';
import { SkeletonCard } from '@/components/Skeleton';
import { SuggestedPeople } from '@/components/SuggestedPeople';

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

type SectionFilter = SearchQuery['type'];

const FILTER_LABELS: Record<SectionFilter, string> = {
  all: 'Всё',
  users: 'Профили',
  posts: 'Посты',
  ideas: 'Идеи',
};

export default function SearchPage() {
  const [query, setQuery] = useState('');
  const [type, setType] = useState<SectionFilter>('all');
  const [results, setResults] = useState<SearchResults | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(false);
  const [discover, setDiscover] = useState<Discover | null>(null);
  const [discoverFailed, setDiscoverFailed] = useState(false);

  /**
   * Loaded once on mount, not on every visit to the empty state — the
   * recommendations shouldn't reshuffle under someone who just cleared the
   * search box to look at them again.
   */
  useEffect(() => {
    api
      .get<Discover>('/discover')
      .then(setDiscover)
      .catch(() => setDiscoverFailed(true));
  }, []);

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
        .get<SearchResults>(`/search?q=${encodeURIComponent(trimmed)}&type=${type}`)
        .then(setResults)
        .catch(() => setError(true))
        .finally(() => setLoading(false));
    }, 300);
    return () => clearTimeout(timeout);
  }, [query, type]);

  const trimmedQuery = query.trim();
  const searching = trimmedQuery.length >= 2;
  const totalCount = results ? results.users.length + results.posts.length + results.ideas.length : 0;

  const showPeople = type === 'all' || type === 'users';
  const showPosts = type === 'all' || type === 'posts';
  const showIdeas = type === 'all' || type === 'ideas';
  const discoverIsEmpty =
    discover !== null &&
    (!showPeople || discover.people.length === 0) &&
    (!showPosts || discover.posts.length === 0) &&
    (!showIdeas || discover.ideas.length === 0);

  return (
    <div style={{ maxWidth: 640, margin: '0 auto' }}>
      <h1 style={{ fontSize: 'var(--z-fs-2xl)', marginTop: 0 }}>Поиск</h1>
      <input
        className="z-input"
        placeholder="Профили, посты, идеи…"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        autoFocus
        style={{ marginBottom: 14, width: '100%' }}
      />

      <div style={{ display: 'flex', gap: 8, marginBottom: 20, flexWrap: 'wrap' }}>
        {searchTypeValues.map((value) => (
          <button
            key={value}
            type="button"
            onClick={() => setType(value)}
            className="z-pop-on-active"
            style={{
              fontSize: 'var(--z-fs-sm)',
              fontWeight: 700,
              padding: '6px 14px',
              borderRadius: 999,
              border: `1px solid ${type === value ? 'var(--z-accent)' : 'var(--z-border)'}`,
              background: type === value ? 'var(--z-accent-soft)' : 'transparent',
              color: type === value ? 'var(--z-accent)' : 'var(--z-text-muted)',
              cursor: 'pointer',
            }}
          >
            {FILTER_LABELS[value]}
          </button>
        ))}
      </div>

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

      {/* Nothing typed yet: this page used to be a blank box, which is the
          worst possible answer to "что тут есть" — the person most likely to
          open search is the one who doesn't know what to search for. */}
      {!searching && !loading && (
        <>
          {discover === null && !discoverFailed && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              {Array.from({ length: 4 }).map((_, i) => (
                <SkeletonCard key={i} lines={1} avatar />
              ))}
            </div>
          )}
          {discoverFailed && (
            <p style={{ color: 'var(--z-text-muted)', fontSize: 'var(--z-fs-sm)' }}>
              Рекомендации не загрузились — поиск при этом работает.
            </p>
          )}
          {discoverIsEmpty && (
            <EmptyState
              icon="🌱"
              title="Здесь пока пусто"
              description="Платформа только разгоняется. Напиши первый пост — и попадёшь сюда."
              action={
                <Link href="/" className="z-btn-accent z-pop-on-active">
                  В ленту
                </Link>
              }
            />
          )}
          {discover && !discoverIsEmpty && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
              {showPeople && discover.people.length > 0 && (
                <section>
                  <h2 style={sectionTitleStyle}>Кого читать</h2>
                  <SuggestedPeople people={discover.people} />
                </section>
              )}

              {showPosts && discover.posts.length > 0 && (
                <section>
                  <h2 style={sectionTitleStyle}>Сейчас обсуждают</h2>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                    {discover.posts.map((p, i) => (
                      <Link key={p.id} href={`/u/${p.author.id}`}>
                        <Card hover className="z-animate-in" style={{ animationDelay: `${Math.min(i, 8) * 40}ms` }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
                            <Avatar name={p.author.displayName} avatarUrl={p.author.avatarUrl} size={24} />
                            <span style={{ fontSize: 'var(--z-fs-sm)', fontWeight: 700 }}>{p.author.displayName}</span>
                            <span style={{ marginLeft: 'auto', fontSize: 'var(--z-fs-xs)', color: 'var(--z-text-faint)' }}>
                              ♥ {p.likeCount} · 💬 {p.commentCount}
                            </span>
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

              {showIdeas && discover.ideas.length > 0 && (
                <section>
                  <h2 style={sectionTitleStyle}>За эти идеи голосуют</h2>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                    {discover.ideas.map((idea, i) => (
                      <Link key={idea.id} href={`/ideas/${idea.id}`}>
                        <Card hover className="z-animate-in" style={{ animationDelay: `${Math.min(i, 8) * 40}ms` }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                            <span className="z-badge">{IDEA_STATUS_LABELS[idea.status] ?? idea.status}</span>
                            <span style={{ marginLeft: 'auto', fontSize: 'var(--z-fs-xs)', color: 'var(--z-accent)', fontWeight: 700 }}>
                              ▲ {idea.voteCount} {plural(idea.voteCount, 'голос', 'голоса', 'голосов')}
                            </span>
                          </div>
                          <div style={{ fontWeight: 700, marginTop: 6 }}>{idea.title}</div>
                          <p style={{ margin: '4px 0 0', color: 'var(--z-text-muted)', fontSize: 'var(--z-fs-sm)' }}>
                            {idea.description.length > 140 ? `${idea.description.slice(0, 140)}…` : idea.description}
                          </p>
                        </Card>
                      </Link>
                    ))}
                  </div>
                </section>
              )}
            </div>
          )}
        </>
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
                          {u.role === 'OWNER' && <span className="z-badge-owner">Владелец проекта</span>}
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
