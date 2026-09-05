import type { Presence } from '@zaa4eem/shared';

const ONLINE_WINDOW_MS = 5 * 60 * 1000;
const AWAY_WINDOW_MS = 30 * 60 * 1000;

/**
 * Computed live from the last heartbeat timestamp rather than stored as an
 * enum — there's nothing to keep in sync or expire on a timer, "offline"
 * just falls out naturally once enough time has passed since the last hit.
 */
export function computePresence(lastActiveAt: Date | null): Presence {
  if (!lastActiveAt) return 'OFFLINE';
  const elapsed = Date.now() - lastActiveAt.getTime();
  if (elapsed <= ONLINE_WINDOW_MS) return 'ONLINE';
  if (elapsed <= AWAY_WINDOW_MS) return 'AWAY';
  return 'OFFLINE';
}
