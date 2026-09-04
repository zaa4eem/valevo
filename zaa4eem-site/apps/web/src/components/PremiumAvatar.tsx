import type { PremiumFields } from '@zaa4eem/shared';
import '@/styles/premium.css';
import { Avatar } from './Avatar';

type PremiumRingProps = Pick<PremiumFields, 'isPremium' | 'ringStyle'>;

/** Shared by PremiumAvatar and any other spot that needs the avatar-frame class directly (e.g. the public profile header's hand-rolled avatar box). */
export const RING_CLASS: Record<string, string> = {
  SPIN: 'ring-spin',
  PULSE: 'ring-pulse',
  GLOW: 'ring-glow',
  RAINBOW: 'ring-rainbow',
  VENOM: 'ring-venom',
};

export function getRingClass(premium?: PremiumRingProps | null): string {
  return premium?.isPremium && premium.ringStyle ? (RING_CLASS[premium.ringStyle] ?? '') : '';
}

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
  const ringClass = getRingClass(premium);

  return (
    <span className={ringClass} style={{ display: 'inline-flex', borderRadius: '50%' }}>
      <Avatar name={name} avatarUrl={avatarUrl} size={size} ring={ring} />
    </span>
  );
}
