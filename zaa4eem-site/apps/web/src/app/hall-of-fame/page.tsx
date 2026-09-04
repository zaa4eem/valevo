'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import type { IdeaCredit } from '@zaa4eem/shared';
import { api } from '@/lib/api-client';
import { Card } from '@/components/Card';
import { EmptyState } from '@/components/EmptyState';
import { SkeletonCard } from '@/components/Skeleton';
import { PremiumAvatar } from '@/components/PremiumAvatar';
import { PremiumName } from '@/components/PremiumName';

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
              <Link href={`/u/${credit.user.id}`} style={{ flexShrink: 0 }}>
                <PremiumAvatar
                  name={credit.user.displayName}
                  avatarUrl={credit.user.avatarUrl}
                  size={36}
                  premium={credit.user}
                />
              </Link>
              <div style={{ flex: 1, minWidth: 0 }}>
                <Link href={`/u/${credit.user.id}`} style={{ fontWeight: 700 }}>
                  <PremiumName name={credit.user.displayName} premium={credit.user} />
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
