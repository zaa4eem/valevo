'use client';

import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import type { Idea } from '@zaa4eem/shared';
import { api } from '@/lib/api-client';
import { IdeaCard } from '@/components/IdeaCard';

export default function IdeaDetailPage() {
  const params = useParams<{ id: string }>();
  const [idea, setIdea] = useState<Idea | null>(null);
  const [notFound, setNotFound] = useState(false);

  useEffect(() => {
    api
      .get<Idea>(`/ideas/${params.id}`)
      .then(setIdea)
      .catch(() => setNotFound(true));
  }, [params.id]);

  if (notFound) return <p style={{ color: 'var(--z-text-muted)' }}>Идея не найдена.</p>;
  if (!idea) return <p style={{ color: 'var(--z-text-muted)' }}>Загрузка…</p>;

  return (
    <div>
      <IdeaCard idea={idea} onVoteChange={() => api.get<Idea>(`/ideas/${params.id}`).then(setIdea)} />
    </div>
  );
}
