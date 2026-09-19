'use client';

import { useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import Link from 'next/link';
import type { Discover, SuggestedPerson } from '@zaa4eem/shared';
import { api } from '@/lib/api-client';
import { SuggestedPeople } from '@/components/SuggestedPeople';

const TITLE_STYLE = {
  fontSize: 'var(--z-fs-sm)',
  textTransform: 'uppercase' as const,
  letterSpacing: '0.06em',
  color: 'var(--z-text-faint)',
  margin: '0 0 10px',
};

/**
 * A titled block of follow suggestions.
 *
 * No loading skeleton and no error state on purpose: this block is never
 * what someone came to the page for, so it stays absent until it has
 * something real, then fades in. A placeholder that reserves space in the
 * middle of a feed and then disappears is worse than a slightly late block.
 */
function SuggestionBlock({
  title,
  people,
  footer,
}: {
  title: string;
  people: SuggestedPerson[] | null;
  footer?: ReactNode;
}) {
  if (!people || people.length === 0) return null;

  return (
    <section className="z-animate-in">
      <h2 style={TITLE_STYLE}>{title}</h2>
      <SuggestedPeople people={people} />
      {footer}
    </section>
  );
}

/** Feed block: a short list, with the full one a tap away. */
export function WhoToFollow({ limit = 3 }: { limit?: number }) {
  const [people, setPeople] = useState<SuggestedPerson[] | null>(null);

  useEffect(() => {
    api
      .get<Discover>('/discover')
      .then((data) => setPeople(data.people.slice(0, limit)))
      .catch(() => setPeople([]));
  }, [limit]);

  return (
    <SuggestionBlock
      title="Кого читать"
      people={people}
      footer={
        <div style={{ marginTop: 8 }}>
          <Link href="/search" style={{ fontSize: 'var(--z-fs-xs)', color: 'var(--z-accent)', fontWeight: 700 }}>
            Смотреть всех →
          </Link>
        </div>
      }
    />
  );
}

/** Profile footer block: who else this person's readers read. */
export function SimilarProfiles({ userId }: { userId: string }) {
  const [people, setPeople] = useState<SuggestedPerson[] | null>(null);

  useEffect(() => {
    // Cleared first, so switching between two profiles never shows the
    // previous person's suggestions under the new person's name.
    setPeople(null);
    api
      .get<SuggestedPerson[]>(`/discover/similar/${userId}`)
      .then(setPeople)
      .catch(() => setPeople([]));
  }, [userId]);

  return <SuggestionBlock title="Похожие профили" people={people} />;
}
