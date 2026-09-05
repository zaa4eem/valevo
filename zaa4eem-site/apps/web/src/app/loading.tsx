import { SkeletonCard, SkeletonText } from '@/components/Skeleton';

/**
 * Shown while a route's own work is in flight. Deliberately shaped like the
 * page that's coming (a heading plus a stack of cards) rather than a spinner
 * or the word "Загрузка…" — a caller can read the layout before the data
 * lands, so the wait reads as "almost there" instead of "nothing happened".
 */
export default function RouteLoading() {
  return (
    <div style={{ maxWidth: 640, margin: '0 auto' }}>
      <SkeletonText width="40%" height={26} style={{ marginBottom: 20 }} />
      <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        <SkeletonCard avatar lines={2} />
        <SkeletonCard avatar lines={3} />
        <SkeletonCard avatar lines={2} />
      </div>
    </div>
  );
}
