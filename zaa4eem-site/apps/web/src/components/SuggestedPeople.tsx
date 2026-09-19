'use client';

import { useState } from 'react';
import Link from 'next/link';
import type { SuggestedPerson } from '@zaa4eem/shared';
import { plural } from '@zaa4eem/shared';
import { api } from '@/lib/api-client';
import { useAuth } from '@/lib/auth-context';
import { haptic } from '@/lib/telegram';
import { Card } from '@/components/Card';
import { PremiumAvatar } from '@/components/PremiumAvatar';
import { PremiumName } from '@/components/PremiumName';

/**
 * "Кого читать" — a suggestion list you can act on without leaving the page.
 *
 * Follow state is kept here rather than read from the person: the API only
 * ever suggests people the viewer *isn't* following, so everyone in the list
 * starts unfollowed and the only state worth tracking is what happened since
 * this list was rendered. That also means a followed row stays put with a
 * "Вы подписаны" label instead of vanishing under the cursor, which is what
 * makes it possible to follow three people in a row.
 */
export function SuggestedPeople({
  people,
  onFollowed,
}: {
  people: SuggestedPerson[];
  onFollowed?: (userId: string) => void;
}) {
  const { user: viewer } = useAuth();
  const [followed, setFollowed] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState<string | null>(null);

  async function follow(person: SuggestedPerson) {
    if (busy) return;
    setBusy(person.id);
    haptic('light');
    setFollowed((current) => new Set(current).add(person.id));
    try {
      await api.post(`/users/${person.id}/follow`);
      onFollowed?.(person.id);
    } catch {
      setFollowed((current) => {
        const next = new Set(current);
        next.delete(person.id);
        return next;
      });
    } finally {
      setBusy(null);
    }
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      {people.map((person, i) => (
        <Card
          key={person.id}
          hover
          className="z-animate-in"
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 12,
            animationDelay: `${Math.min(i, 8) * 40}ms`,
          }}
        >
          <Link href={`/u/${person.id}`} style={{ display: 'inline-flex', flexShrink: 0 }}>
            <PremiumAvatar
              name={person.displayName}
              avatarUrl={person.avatarUrl}
              size={40}
              premium={person}
            />
          </Link>

          <div style={{ flex: 1, minWidth: 0 }}>
            <Link
              href={`/u/${person.id}`}
              style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}
            >
              <span style={{ fontWeight: 700 }}>
                <PremiumName name={person.displayName} premium={person} />
              </span>
              {person.role === 'OWNER' && <span className="z-badge-owner">Владелец проекта</span>}
              {person.level > 1 && (
                <span
                  className="z-badge"
                  style={{ background: 'var(--z-accent-soft)', color: 'var(--z-accent)' }}
                  title="Уровень активности"
                >
                  ур. {person.level}
                </span>
              )}
            </Link>
            {/* The reason is the whole point of this list — a bare list of
                strangers reads as an ad, "на него подписаны 3 из ваших"
                reads as a recommendation. */}
            {/* Wraps rather than truncates: at 390px an ellipsis eats the
                follower count and leaves "Популярный автор · 4 подписчи…",
                which is the half of the line that carries no information. */}
            <div
              style={{
                fontSize: 'var(--z-fs-xs)',
                color: 'var(--z-text-faint)',
                marginTop: 2,
                lineHeight: 1.35,
              }}
            >
              {person.reason}
              {person.followerCount > 0 && (
                <>
                  {' · '}
                  {person.followerCount}{' '}
                  {plural(person.followerCount, 'подписчик', 'подписчика', 'подписчиков')}
                </>
              )}
            </div>
          </div>

          {viewer ? (
            followed.has(person.id) ? (
              <span
                style={{
                  fontSize: 'var(--z-fs-xs)',
                  color: 'var(--z-text-faint)',
                  fontWeight: 700,
                  flexShrink: 0,
                }}
              >
                Вы подписаны
              </span>
            ) : (
              <button
                onClick={() => follow(person)}
                disabled={busy === person.id}
                className="z-btn-accent z-pop-on-active"
                style={{ fontSize: 'var(--z-fs-xs)', padding: '6px 12px', flexShrink: 0 }}
              >
                + Подписаться
              </button>
            )
          ) : (
            <Link
              href="/login"
              className="z-btn-ghost z-pop-on-active"
              style={{ fontSize: 'var(--z-fs-xs)', padding: '6px 12px', flexShrink: 0 }}
            >
              Войти
            </Link>
          )}
        </Card>
      ))}
    </div>
  );
}
