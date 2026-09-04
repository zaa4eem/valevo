'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import type { IdeaCredit } from '@zaa4eem/shared';
import { api } from '@/lib/api-client';
import { Card } from '@/components/Card';
import { EmptyState } from '@/components/EmptyState';
import { SkeletonCard } from '@/components/Skeleton';

export default function HallOfFamePage() {
  const [credits, setCredits] = useState<IdeaCredit[] | null>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    api.get<IdeaCredit[]>('/idea-credits').then(setCredits, () => setError(true));
  }, []);

  return (
    <div style={{ maxWidth: 640 }}>
      <h1 style={{ fontSize: 'var(--z-fs-2xl)', fontWeight: 900, marginBottom: 4 }}>💡 Зал славы</h1>
      <p style={{ color: 'var(--z-text-muted)', fontSize: 'var(--z-fs-sm)', marginTop: 0, marginBottom: 20 }}>
        Идеи людей, которые стали настоящими функциями ZAA4EEM.
      </p>

      {error ? (
        <p style={{ color: 'var(--z-danger)' }}>Не удалось загрузить список.</p>
      ) : !credits ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <SkeletonCard lines={2} />
          <SkeletonCard lines={2} />
        </div>
      ) : credits.length === 0 ? (
        <EmptyState icon="💡" title="Пока пусто" description="Здесь появятся идеи, которые стали фичами сайта." />
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {credits.map((credit) => (
            <Card key={credit.id} hover className="z-animate-in" style={{ display: 'flex', gap: 12, alignItems: 'flex-start' }}>
              <div
                style={{
                  width: 36,
                  height: 36,
                  borderRadius: '50%',
                  background: 'var(--z-accent-soft)',
                  color: 'var(--z-accent)',
                  display: 'grid',
                  placeItems: 'center',
                  fontWeight: 800,
                  fontSize: 'var(--z-fs-sm)',
                  flexShrink: 0,
                }}
              >
                {credit.user.displayName.charAt(0).toUpperCase()}
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <Link href={`/u/${credit.user.id}`} style={{ fontWeight: 700 }}>
                  {credit.user.displayName}
                </Link>
                <p style={{ margin: '4px 0 0', fontSize: 'var(--z-fs-sm)', color: 'var(--z-text-muted)' }}>
                  {credit.description}
                </p>
              </div>
              <div style={{ fontSize: 'var(--z-fs-xs)', color: 'var(--z-text-faint)', flexShrink: 0, whiteSpace: 'nowrap' }}>
                {new Date(credit.createdAt).toLocaleDateString('ru-RU')}
              </div>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
