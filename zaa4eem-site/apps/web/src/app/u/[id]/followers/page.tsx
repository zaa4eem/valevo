'use client';

import { useParams } from 'next/navigation';
import { FollowList } from '@/components/FollowList';

export default function FollowersPage() {
  const params = useParams<{ id: string }>();
  return (
    <FollowList
      userId={params.id}
      kind="followers"
      title="Подписчики"
      emptyText="Пока нет подписчиков."
    />
  );
}
