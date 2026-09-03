'use client';

import { useParams } from 'next/navigation';
import { FollowList } from '@/components/FollowList';

export default function FollowingPage() {
  const params = useParams<{ id: string }>();
  return (
    <FollowList
      userId={params.id}
      kind="following"
      title="Подписки"
      emptyText="Пока ни на кого не подписан(а)."
    />
  );
}
