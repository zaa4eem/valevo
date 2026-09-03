import type { PremiumFields } from '@zaa4eem/shared';
import '@/styles/premium.css';
import { Avatar } from './Avatar';

type PremiumRingProps = Pick<PremiumFields, 'isPremium' | 'ringStyle'>;

/** Wraps Avatar with the owner-granted Premium animated ring frame (if any) — a spinning conic gradient or a pulsing glow. */
export function PremiumAvatar({
  name,
  avatarUrl,
  size = 40,
  ring = false,
  premium,
}: {
  name: string;
  avatarUrl?: string | null;
  size?: number;
  ring?: boolean;
  premium?: PremiumRingProps | null;
}) {
  const ringClass =
    premium?.isPremium && premium.ringStyle === 'SPIN'
      ? 'ring-spin'
      : premium?.isPremium && premium.ringStyle === 'PULSE'
        ? 'ring-pulse'
        : '';

  return (
    <span className={ringClass} style={{ display: 'inline-flex', borderRadius: '50%' }}>
      <Avatar name={name} avatarUrl={avatarUrl} size={size} ring={ring} />
    </span>
  );
}
